// providers/hotelizer.js
// Hotelizer PMS integration (https://hotelizer.gitbook.io/hotelizer-api).
//
// Auth: HTTP Basic — api_key_name (username) + api_key_secret (password).
//   Demo creds are public in the docs (Guidelines page):
//     username: "username"  password: "pass"
//
// Listings: GET /api/integrations/rooms
//   Returns the physical rooms in the property. We store rooms.name as
//   the platform_id (e.g. "307", "105") — same convention as RoomRack.
//
// Sync: GET /api/integrations/accommodations
//   Returns one row per physical-accommodation-line per booking, with
//   rooms.name pre-joined. This endpoint has NO per-room filter — we
//   fetch the full window once per store and filter client-side by
//   rooms.name === room.platform_id. To avoid N redundant fetches when
//   a store has many rooms, we cache the fetched array in module scope
//   keyed by `${store_id}:${fromIso}:${toIso}` for the lifetime of the
//   warm Lambda container (which spans a single cron invocation).
//
// Breakfast detection: each accommodation has `board_types.code` like
//   BB / HB / FB / AI / RR (Room only) / NB / NONE. Same prefix-match
//   logic as RoomRack. board_types can also be `{}` (empty) — treat as
//   no breakfast.
//
// Status mapping: reservation_statuses.name ∈ { Confirmed, In House,
//   Checked Out, Cancelled, No-Show, ... }. Cancelled and No-Show map
//   to 'cancelled'; everything else maps to 'confirmed'.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
  supabase,
} from './_shared.js';

const BASE_URL = 'https://app.hotelizer.net/api/integrations';
const PAGE_LIMIT = 100;

// Module-level cache: `${store_id}:${fromIso}:${toIso}` → array of accommodations.
// Survives within a single warm Lambda container (i.e. one cron run that loops
// through all rooms for the same store). NOT a persistence layer.
const accommodationsCache = new Map();

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncHotelizer(room, { lookbackDays, forwardDays }) {
  const logId = await startLog(room.id, 'hotelizer');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const store = room.stores;
  const username = store?.api_key_name;
  const password = store?.api_key_secret;
  if (!username || !password) {
    const err = 'Missing api_key_name / api_key_secret on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'hotelizer', error: err };
  }

  try {
    // Fetch (or reuse cached) accommodations for this store + window.
    const cacheKey = `${room.store_id}:${fromIso}:${toIso}`;
    let allAccommodations = accommodationsCache.get(cacheKey);

    if (!allAccommodations) {
      allAccommodations = await fetchAllAccommodations(
        { username, password },
        { checkin_from: fromIso, checkin_to: toIso }
      );
      accommodationsCache.set(cacheKey, allAccommodations);
    }

    // Client-side filter to just this room. We match on rooms.name because
    // that's what we stored as platform_id.
    const ours = allAccommodations.filter(
      a => String(a?.rooms?.name ?? '').trim() === String(room.platform_id).trim()
    );

    const stats = await upsertBookings(room, 'hotelizer', ours, transformAccommodation, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'hotelizer', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'hotelizer', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchHotelizerListings(store) {
  const username = store.api_key_name;
  const password = store.api_key_secret;
  if (!username || !password) {
    throw new Error('No Hotelizer credentials set on this store. Add username (api_key_name) and password (api_key_secret) in Store settings.');
  }

  const rooms = await fetchAllPaged(
    `${BASE_URL}/rooms`,
    { username, password },
    {}
  );

  const listings = rooms
    // Skip virtual rooms — they're abstract buckets, not physical units we can
    // tie a GonnaOrder location to.
    .filter(r => !r.is_virtual && r.active !== 0)
    .map(r => ({
      platform_id: String(r.name ?? r.id ?? ''),
      name: `Room ${r.name ?? r.id}${r.room_types?.name ? ` (${r.room_types.name})` : ''}`,
      capacity: r.room_types?.capacity_max_pers ?? null,
      platform: 'hotelizer',
    }))
    .filter(l => l.platform_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'hotelizer' }),
  };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

// Fetch every accommodation in the window across all pages.
async function fetchAllAccommodations(creds, { checkin_from, checkin_to }) {
  return fetchAllPaged(`${BASE_URL}/accommodations`, creds, {
    checkin_from,
    checkin_to,
  });
}

// Generic paginated GET — Hotelizer wraps responses as
// `{ success, data: [...], summary: { page, pages, count } }`.
async function fetchAllPaged(url, { username, password }, extraParams) {
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const all = [];
  let page = 1;
  let pages = 1;

  do {
    const qs = new URLSearchParams({ ...extraParams, page: String(page), limit: String(PAGE_LIMIT) });
    const res = await fetch(`${url}?${qs.toString()}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hotelizer API error ${res.status} on ${url}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    if (!json?.success) {
      throw new Error(`Hotelizer API returned success=false on ${url}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    if (Array.isArray(json.data)) all.push(...json.data);
    pages = Number(json?.summary?.pages ?? 1);
    page += 1;
  } while (page <= pages);

  return all;
}

// ─── Transform ───────────────────────────────────────────────────────────────
function transformAccommodation(a) {
  const adults   = parseInt(a.adults   ?? 0, 10);
  const children = parseInt(a.children ?? 0, 10);
  const infants  = parseInt(a.infants  ?? 0, 10);
  const guests   = (adults + children + infants) || 1;

  const statusName = String(a?.reservation_statuses?.name || '').trim().toLowerCase();
  const status = (statusName === 'cancelled' || statusName === 'no-show' || statusName === 'no show')
    ? 'cancelled'
    : 'confirmed';

  // Prefer the standard PMS code (BB/RR/HB/FB/AI). Fall back to the human
  // name. board_types can be `{}` — both lookups yield undefined → false.
  const boardCode = a?.board_types?.code;
  const boardName = a?.board_types?.name;
  const breakfast = boardIncludesBreakfast(boardCode) || boardIncludesBreakfast(boardName);

  return {
    external_id:        String(a.id ?? ''),
    room_code:          String(a?.rooms?.name ?? ''),
    check_in:           toIsoDate(a.fromd),
    check_out:          toIsoDate(a.tod),
    guest_count:        guests,
    breakfast_included: !!breakfast,
    status,
    raw_data:           a,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Hotelizer returns dates as 'YYYY-MM-DD' already. Normalise defensively.
function toIsoDate(s) {
  if (!s || typeof s !== 'string') return '';
  // Strip a trailing time if ever present (e.g. "2026-05-17 14:00:00").
  return s.slice(0, 10);
}

// Map Hotelizer `board_types.code` (or name) → breakfast included? (boolean)
//
// Codes seen in demo: BB (Breakfast), RR (Room only). Standard PMS codes
// covered as in RoomRack: BB/HB/FB/AI/UAI → yes; RO/OB/BO/NB/RR/NONE → no.
// Free-text fallback (English + Greek) covers anything else.
function boardIncludesBreakfast(board) {
  if (!board) return false;
  const raw = String(board).trim();
  if (!raw) return false;

  const upper = raw.toUpperCase();

  // No-board codes — explicit deny.
  if (['RO', 'OB', 'BO', 'NB', 'RR', 'NONE', 'NO BOARD', 'ROOM ONLY'].includes(upper)) return false;

  // Code prefixes that include breakfast.
  if (/^(BB|HB|FB|AI|UAI)/.test(upper)) return true;

  // Free-text fallback (English + Greek).
  const lower = raw.toLowerCase();
  if (
    lower.includes('breakfast') ||
    lower.includes('b&b')       ||
    lower.includes('bed and breakfast') ||
    lower.includes('half board') ||
    lower.includes('full board') ||
    lower.includes('all incl')   ||
    lower.includes('inclusive')  ||
    lower.includes('πρωιν')      // matches πρωινό, πρωινού, …
  ) {
    return true;
  }

  return false;
}

// `supabase` import is here only to keep the surface area parallel to
// roomrack.js — we don't currently need a direct query but future
// per-property settings (e.g. board allowlist override) can use it.
void supabase;
