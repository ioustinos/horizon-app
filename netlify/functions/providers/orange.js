// providers/orange.js
// Orange Cloud PMS (Coral API) integration (https://hotel.orangepms.com/api.html).
// Vendor: Marinet Ltd (apolymerou@marinet.gr). Demo creds received 2026-07-07:
//   username wecook / hotel ID 777 ("ZENITH PREMIUM SUITES").
//
// Auth: HTTP Basic — api_key_name (username) + api_key_secret (password).
//   Credentials are per-user; /orange/hotels lists the hotels assigned to
//   the user. We auto-discover the hotel ID when the account has exactly
//   one hotel. If the account has several, set api_key_name to
//   "username:hotelID" (e.g. "wecook:777") to disambiguate.
//
// Listings: GET /orange/hotels/{hotelId}/rooms
//   Physical rooms with RoomNumber (e.g. "101"). platform_id = RoomNumber
//   (same convention as RoomRack / Hotelizer). Virtual / inactive rooms
//   are filtered out.
//
// Sync: GET /orange/reservations?hotel={id}&departure_from=…&arrival_to=…
//   Overlap window: DepartureDate >= from AND ArrivalDate <= to.
//   The endpoint supports a server-side `room` filter, but the vendor asked
//   us to keep call volume around 1/hour — so we deliberately fetch the full
//   window ONCE per store per cron cycle and filter client-side per room
//   (module-level cache, same pattern as Hotelizer). Dates are YYYY-MM-DD
//   in both directions. No pagination documented; verified 926 rows in one
//   response against the demo hotel.
//
// Breakfast detection: each reservation carries `MealPlan`. Vendor-confirmed
//   vocabulary (2026-07-07 email): ROOM / BB / HB / FB / AI.
//   BB / HB / FB / AI → breakfast; ROOM → none. Same prefix + free-text
//   fallback logic as RoomRack for safety. No per-store config needed.
//
// Status mapping: StatusCode ∈ { 1 Definite, 2 Tentative, 3 Guaranteed,
//   5 Cancelled, 6 Checked-in, 7 Checked-out, 8 Wait list }.
//   5 (Cancelled) and 8 (Wait list — not a confirmed stay) → 'cancelled';
//   a non-empty CancellationDate also forces 'cancelled';
//   everything else → 'confirmed'.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
} from './_shared.js';

const BASE_URL = 'https://hotel.orangepms.com/orange';

// Module-level caches (warm-container lifetime only):
//   hotelIdCache:      username → hotelId (auto-discovered via /hotels)
//   reservationsCache: `${hotelId}:${fromIso}:${toIso}` → array of reservations
const hotelIdCache = new Map();
const reservationsCache = new Map();

function basicAuthHeader(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// api_key_name may be "username" or "username:hotelID".
function parseCreds(store) {
  const rawName = String(store?.api_key_name || '').trim();
  const password = store?.api_key_secret;
  if (!rawName || !password) return null;
  const idx = rawName.lastIndexOf(':');
  if (idx > 0 && /^\d+$/.test(rawName.slice(idx + 1))) {
    return { username: rawName.slice(0, idx), password, hotelId: rawName.slice(idx + 1) };
  }
  return { username: rawName, password, hotelId: null };
}

async function orangeGet(path, creds) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: basicAuthHeader(creds.username, creds.password),
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Orange API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  if (!text || !text.trim()) return [];
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Orange API returned invalid JSON (${text.length} chars): ${e.message}`);
  }
}

async function resolveHotelId(creds) {
  if (creds.hotelId) return creds.hotelId;
  const cached = hotelIdCache.get(creds.username);
  if (cached) return cached;
  const hotels = await orangeGet('/hotels', creds);
  const list = Array.isArray(hotels) ? hotels : [];
  if (list.length === 0) throw new Error('Orange API: no hotels assigned to this user.');
  if (list.length > 1) {
    throw new Error(
      `Orange API: ${list.length} hotels assigned to this user (${list.map(h => `${h.HotelID}=${h.HotelName}`).join(', ')}). ` +
      'Set the store username to "username:hotelID" to pick one.'
    );
  }
  const id = String(list[0].HotelID);
  hotelIdCache.set(creds.username, id);
  return id;
}

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncOrange(room, { lookbackDays, forwardDays }) {
  const logId   = await startLog(room.id, 'orange');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const creds = parseCreds(room.stores);
  if (!creds) {
    const err = 'Missing api_key_name / api_key_secret on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'orange', error: err };
  }

  try {
    const hotelId = await resolveHotelId(creds);

    // Fetch (or reuse cached) reservations for this hotel + window.
    // Overlap semantics: DepartureDate >= from AND ArrivalDate <= to.
    const cacheKey = `${hotelId}:${fromIso}:${toIso}`;
    let allReservations = reservationsCache.get(cacheKey);
    if (!allReservations) {
      const params = new URLSearchParams({
        hotel: hotelId,
        departure_from: fromIso,
        arrival_to: toIso,
        simple: '0',
      });
      const data = await orangeGet(`/reservations?${params.toString()}`, creds);
      allReservations = Array.isArray(data) ? data : [];
      reservationsCache.set(cacheKey, allReservations);
    }

    // Client-side filter to this room (platform_id = RoomNumber).
    const ours = allReservations.filter(r =>
      String(r?.RoomNumber ?? '').trim() === String(room.platform_id).trim()
    );

    const rawResponse = {
      hotel_id: hotelId,
      window: { from: fromIso, to: toIso },
      total_reservations_in_response: allReservations.length,
      filtered_for_this_room: ours.length,
      sample_first_reservation: ours[0] || null,
    };

    const stats = await upsertBookings(room, 'orange', ours, (b) => {
      const adults   = parseInt(b.Adults   ?? 0, 10) || 0;
      const children = parseInt(b.Children ?? 0, 10) || 0;
      const infants  = parseInt(b.Infants  ?? 0, 10) || 0;
      const guests   = (adults + children + infants) || 1;

      const statusCode = parseInt(b.StatusCode ?? 0, 10);
      const cancelled  = statusCode === 5 || statusCode === 8 ||
        Boolean(String(b.CancellationDate || '').trim());

      return {
        external_id:        String(b.ReservationID || ''),
        room_code:          String(b.RoomNumber || room.platform_id || ''),
        check_in:           normalizeIsoDate(b.ArrivalDate),
        check_out:          normalizeIsoDate(b.DepartureDate),
        guest_count:        guests,
        breakfast_included: mealPlanIncludesBreakfast(b.MealPlan),
        status:             cancelled ? 'cancelled' : 'confirmed',
        raw_data:           b,
      };
    }, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats, null, rawResponse);
    return { room_id: room.id, name: room.name, provider: 'orange', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message, { exception: err.message, stack: (err.stack || '').slice(0, 1000) });
    return { room_id: room.id, name: room.name, provider: 'orange', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchOrangeListings(store) {
  const creds = parseCreds(store);
  if (!creds) {
    throw new Error('Missing username (API Key Name) or password (API Key Secret) on this store.');
  }

  const hotelId = await resolveHotelId(creds);
  const data = await orangeGet(`/hotels/${encodeURIComponent(hotelId)}/rooms`, creds);
  const rooms = Array.isArray(data) ? data : [];

  const listings = rooms
    .filter(r => parseInt(r.Active ?? 1, 10) === 1 && parseInt(r.Virtual ?? 0, 10) !== 1)
    .map(r => ({
      // platform_id = RoomNumber — matches `RoomNumber` on reservations.
      platform_id: String(r.RoomNumber ?? '').trim(),
      name:        r.RoomType ? `Room ${r.RoomNumber} — ${r.RoomType}` : `Room ${r.RoomNumber}`,
      capacity:    r.Capacity ?? null,
      platform:    'orange',
    }))
    .filter(l => l.platform_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'orange' }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Defensive YYYY-MM-DD normalization (Orange already returns YYYY-MM-DD).
function normalizeIsoDate(s) {
  if (!s || typeof s !== 'string') return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

// Map Orange `MealPlan` → breakfast included? (boolean)
// Vendor-confirmed vocabulary: ROOM / BB / HB / FB / AI.
function mealPlanIncludesBreakfast(mealPlan) {
  if (!mealPlan) return false;
  const raw = String(mealPlan).trim();
  if (!raw) return false;

  const upper = raw.toUpperCase();

  // No-board codes — explicit deny.
  if (['ROOM', 'RO', 'OB', 'BO', 'NB', 'NONE', 'NO BOARD', 'ROOM ONLY'].includes(upper)) return false;

  // Board codes that include breakfast.
  if (/^(BB|HB|FB|AI|UAI)/.test(upper)) return true;

  // Free-text fallback (English + Greek), matching the RoomRack logic.
  const lower = raw.toLowerCase();
  if (
    lower.includes('breakfast') ||
    lower.includes('b&b') ||
    lower.includes('bed and breakfast') ||
    lower.includes('half board') ||
    lower.includes('full board') ||
    lower.includes('all incl') ||
    lower.includes('inclusive') ||
    lower.includes('πρωιν')
  ) {
    return true;
  }

  return false;
}
