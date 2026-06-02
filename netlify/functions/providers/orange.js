// providers/orange.js
// Orange PMS integration — CORAL API (Marinet Ltd, https://hotel.orangepms.com/api.html).
//
// SCAFFOLD ONLY — kept on branch `orange-scaffold` until demo / sandbox
// credentials are issued by Marinet. No migration applied; not wired
// into dispatchers; not exposed in UI. Per the horizon-add-integration
// Phase 2 mandatory rule (do not let a real property become the guinea
// pig), we hold this branch and only merge after end-to-end testing
// against a sandbox / test hotel.
//
// Auth: HTTP Basic — api_key_name (username) + api_key_secret (password).
//   Per CORAL docs, the same credentials are scoped to one or more
//   hotels via GET /orange/hotels. We auto-discover (and cache) the
//   first hotel returned; multi-hotel support requires a schema field
//   on stores (pms_account_id or similar) — flagged as TODO below.
//
// Listings: GET /orange/hotels/{hotel_id}/rooms
//   Returns physical rooms: { RoomID, RoomNumber, RoomTypeID, RoomType,
//   Capacity, Active, Virtual }. We store rooms.platform_id = RoomNumber
//   (matches the convention used by RoomRack / Hotelizer; this is what
//   ends up as GonnaOrder's Table Name).
//
// Sync: GET /orange/reservations?hotel={id}&arrival_from=YYYY-MM-DD
//          &arrival_to=YYYY-MM-DD&status=1234567
//   The default status combo (12367) excludes Cancelled (5) and Wait
//   list (8); we explicitly include all so cancellations are visible.
//   No documented per-room filter — we fetch the full window per store
//   and filter client-side by RoomNumber, with the same module-level
//   cache pattern as Hotelizer to avoid redundant fetches when one
//   store has many rooms.
//
// Status mapping (per CORAL docs):
//   1=Definite, 2=Tentative, 3=Guaranteed, 5=Cancelled,
//   6=Checked-in, 7=Checked-out, 8=Wait list
//   StatusCode === 5 → 'cancelled'; everything else → 'confirmed'.
//
// Breakfast detection: reservation.MealPlan field. Per the docs example
// "BB"; full enum NOT documented — we use the same prefix-match logic
// as RoomRack / Hotelizer (BB / HB / FB / AI / UAI → true; RO / NB / OB
// / NONE → false; English + Greek free-text fallback).
//
// Date format: YYYY-MM-DD (input + output).
//
// Pagination: NOT documented. Current assumption is single-shot —
// chunked by date window (our 30+90 default keeps responses small).
// If we see truncation in production we'll add explicit ?page= /
// ?offset= probing then.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
  supabase,
} from './_shared.js';

const BASE_URL = 'https://hotel.orangepms.com/orange';
// All five non-waitlist statuses so cancellations come through.
const STATUS_FILTER = '12356';

// Module-level cache: `${store_id}:${fromIso}:${toIso}` → array of reservations.
const reservationsCache = new Map();
// Module-level cache: `${store_id}` → hotelId (auto-discovered from /orange/hotels).
const hotelIdCache = new Map();

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncOrange(room, { lookbackDays, forwardDays }) {
  const logId = await startLog(room.id, 'orange');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const store = room.stores;
  const username = store?.api_key_name;
  const password = store?.api_key_secret;
  if (!username || !password) {
    const err = 'Missing api_key_name / api_key_secret on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'orange', error: err };
  }

  try {
    const hotelId = await resolveHotelId(store, { username, password });

    // Fetch (or reuse cached) reservations for this store + window.
    const cacheKey = `${room.store_id}:${fromIso}:${toIso}`;
    let allReservations = reservationsCache.get(cacheKey);

    if (!allReservations) {
      allReservations = await fetchReservations(
        { username, password },
        { hotel: hotelId, arrival_from: fromIso, arrival_to: toIso, status: STATUS_FILTER }
      );
      reservationsCache.set(cacheKey, allReservations);
    }

    // Client-side filter by RoomNumber (== room.platform_id).
    const ours = allReservations.filter(
      r => String(r?.RoomNumber ?? '').trim() === String(room.platform_id).trim()
    );

    const stats = await upsertBookings(room, 'orange', ours, transformReservation, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'orange', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'orange', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchOrangeListings(store) {
  const username = store.api_key_name;
  const password = store.api_key_secret;
  if (!username || !password) {
    throw new Error('No Orange credentials set on this store. Add username (api_key_name) and password (api_key_secret) in Store settings.');
  }

  const hotelId = await resolveHotelId(store, { username, password });
  const rooms = await apiGet(`${BASE_URL}/hotels/${hotelId}/rooms`, { username, password });

  const listings = (Array.isArray(rooms) ? rooms : [])
    // Skip virtual rooms (abstract buckets) and inactive ones.
    .filter(r => !r.Virtual && r.Active !== 0 && r.Active !== false)
    .map(r => ({
      platform_id: String(r.RoomNumber ?? r.RoomID ?? ''),
      name: `Room ${r.RoomNumber ?? r.RoomID}${r.RoomType ? ` (${r.RoomType})` : ''}`,
      capacity: r.Capacity ?? null,
      platform: 'orange',
    }))
    .filter(l => l.platform_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'orange', hotel_id: hotelId }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Auto-discover the HotelID for a store by calling /orange/hotels and
// taking the first hotel returned. Cached per-store for the Lambda
// container lifetime.
//
// TODO (when going live): if a customer has multiple hotels under one
// CORAL account, we need a `pms_account_id` column on stores so each
// store can pin to one specific HotelID. For now (scaffold + single-
// hotel demo), the first hotel is what we want.
async function resolveHotelId(store, creds) {
  if (hotelIdCache.has(store.id)) return hotelIdCache.get(store.id);

  const hotels = await apiGet(`${BASE_URL}/hotels`, creds);
  const list = Array.isArray(hotels) ? hotels : [];
  if (!list.length) {
    throw new Error('Orange API returned no hotels for these credentials');
  }
  const id = list[0].HotelID ?? list[0].Hotel_ID ?? list[0].id;
  if (!id) {
    throw new Error('Orange /hotels response missing HotelID field');
  }
  hotelIdCache.set(store.id, id);
  return id;
}

async function fetchReservations(creds, params) {
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    )
  );
  return apiGet(`${BASE_URL}/reservations?${qs.toString()}`, creds);
}

// Generic GET → JSON with HTTP Basic auth.
async function apiGet(url, { username, password }) {
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Orange API error ${res.status} on ${url}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Transform ───────────────────────────────────────────────────────────────
function transformReservation(r) {
  const adults   = parseInt(r.Adults   ?? r.adults   ?? 0, 10);
  const children = parseInt(r.Children ?? r.children ?? 0, 10);
  const infants  = parseInt(r.Infants  ?? r.infants  ?? 0, 10);
  const guests   = (adults + children + infants) || 1;

  const statusCode = Number(r.StatusCode ?? r.Status ?? 0);
  const status = statusCode === 5 ? 'cancelled' : 'confirmed';

  // MealPlan field on reservation — per docs example "BB"; full enum not
  // documented. boardIncludesBreakfast handles BB/HB/FB/AI prefixes plus
  // free-text English + Greek fallback.
  const mealPlan = r.MealPlan ?? r.mealPlan ?? '';
  const breakfast = boardIncludesBreakfast(mealPlan);

  return {
    external_id:        String(r.ReservationID ?? r.ReservationNumber ?? r.id ?? ''),
    room_code:          String(r.RoomNumber ?? ''),
    check_in:           toIsoDate(r.ArrivalDate ?? r.arrival_date ?? r.CheckIn ?? ''),
    check_out:          toIsoDate(r.DepartureDate ?? r.departure_date ?? r.CheckOut ?? ''),
    guest_count:        guests,
    breakfast_included: !!breakfast,
    status,
    raw_data:           r,
  };
}

// Orange dates are YYYY-MM-DD per the docs; normalise defensively.
function toIsoDate(s) {
  if (!s || typeof s !== 'string') return '';
  return s.slice(0, 10);
}

// Same board-detection logic as Hotelizer / RoomRack — keep these in
// lockstep so behavior is consistent across PMS connectors.
function boardIncludesBreakfast(board) {
  if (!board) return false;
  const raw = String(board).trim();
  if (!raw) return false;

  const upper = raw.toUpperCase();

  if (['RO', 'OB', 'BO', 'NB', 'RR', 'NONE', 'NO BOARD', 'ROOM ONLY'].includes(upper)) return false;
  if (/^(BB|HB|FB|AI|UAI)/.test(upper)) return true;

  const lower = raw.toLowerCase();
  if (
    lower.includes('breakfast') ||
    lower.includes('b&b')       ||
    lower.includes('bed and breakfast') ||
    lower.includes('half board') ||
    lower.includes('full board') ||
    lower.includes('all incl')   ||
    lower.includes('inclusive')  ||
    lower.includes('πρωιν')
  ) {
    return true;
  }

  return false;
}

void supabase;
