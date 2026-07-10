// providers/lodgify.js
// Lodgify Public API v1/v2 integration (https://docs.lodgify.com).
//
// STATUS: UNVERIFIED AGAINST LIVE DATA — implemented from the public docs +
// Lodgify product-team guidance (email via Myrsini Pappa, received 2026-07-10).
// No API key is available yet (keys are per host account, generated at
// Settings → Integrations → Public API → "Find your API key"). Exercise
// end-to-end against the first real/demo key before relying on it.
//
// Auth: `X-ApiKey: <key>` header on every request. One key per Lodgify
//   account, covers all rentals of that account.
//   Store schema: api_key_secret = the API key; api_key_name is UNUSED.
//
// Listings: GET /v1/properties → properties with their room types.
//   Lodgify bookings identify a room TYPE (room_type_id), never a physical
//   unit — so Horizon's platform_id is "propertyId:roomTypeId". For the
//   typical Lodgify property (whole vacation rental, 1 unit per type) that
//   IS the physical unit. Room types with units > 1 cannot be disambiguated
//   (WebHotelier-style limitation) — we surface `units` in the listing name
//   when > 1 so the operator can see it.
//   Per-type details (max_people, breakfast flag) come from
//   GET /v1/properties/{id}/rooms/{rid}.
//
// Sync: GET /v2/reservations/bookings?includeQuoteDetails=true
//   No date-range params exist — only stayFilter enums. We page through
//   stayFilter=Current and stayFilter=Upcoming (covers every booking that
//   can still receive breakfast) once per store per cron cycle, cache in
//   module scope, and filter client-side by property_id + room_type_id.
//   Rate limits: 600 req/min (v1) / 750 req/min (v2) — far above our usage.
//
// Breakfast detection (per Lodgify product team, 2026-07-10):
//   1. Booking-level "Breakfast" ADD-ON — an addon quote item whose
//      description/type mentions breakfast (quote.addon_items[]). OTA
//      bookings (Airbnb / Booking.com / Vrbo) never carry add-ons through
//      the channel manager, hence:
//   2. Room-type-level fallback — the "Breakfast included" amenity flag
//      (breakfast_included boolean on /v1/properties/{id}/rooms/{rid},
//      set in Dashboard → Rentals → Overview → Amenities). Cached per
//      room type at sync time.
//   3. Default false.
//
// Status mapping: status ∈ { Open, Tentative, Booked, Declined }.
//   Only 'Booked' → 'confirmed'. Declined / Open / Tentative (enquiries and
//   unconfirmed holds), a non-null canceled_at, or is_deleted → 'cancelled'.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
} from './_shared.js';

const V1 = 'https://api.lodgify.com/v1';
const V2 = 'https://api.lodgify.com/v2';
const PAGE_SIZE = 50;

// Module-level caches (warm-container lifetime only):
//   bookingsCache:      `${store_id}:${fromIso}:${toIso}` → array of bookings
//   roomBreakfastCache: `${apiKeyPrefix}:${pid}:${rid}` → boolean|null
const bookingsCache = new Map();
const roomBreakfastCache = new Map();

async function lodgifyGet(url, apiKey) {
  const res = await fetch(url, {
    headers: { 'X-ApiKey': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Lodgify API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Lodgify API returned invalid JSON (${text.length} chars): ${e.message}`);
  }
}

// platform_id = "propertyId:roomTypeId"
function parsePlatformId(platformId) {
  const m = String(platformId || '').trim().match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return { propertyId: m[1], roomTypeId: m[2] };
}

async function fetchBookingsPage(apiKey, stayFilter, page) {
  const params = new URLSearchParams({
    page: String(page),
    size: String(PAGE_SIZE),
    includeQuoteDetails: 'true',
    stayFilter,
    trash: 'False',
  });
  const data = await lodgifyGet(`${V2}/reservations/bookings?${params.toString()}`, apiKey);
  // Response is { count, items: [...] } — defend against a bare array too.
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : [];
}

async function fetchAllBookings(apiKey) {
  const byId = new Map();
  for (const stayFilter of ['Current', 'Upcoming']) {
    for (let page = 1; page <= 40; page++) {   // hard cap: 40 pages × 50 = 2000/filter
      const items = await fetchBookingsPage(apiKey, stayFilter, page);
      items.forEach(b => { if (b && b.id != null) byId.set(String(b.id), b); });
      if (items.length < PAGE_SIZE) break;
    }
  }
  return [...byId.values()];
}

// Tier-1: booking-level "Breakfast" add-on in the quote items.
function bookingHasBreakfastAddon(booking) {
  const quotes = Array.isArray(booking?.quote) ? booking.quote
    : booking?.quote ? [booking.quote] : [];
  for (const q of quotes) {
    const buckets = [q?.addon_items, q?.other_items].filter(Array.isArray);
    for (const bucket of buckets) {
      for (const item of bucket) {
        const label = `${item?.description || ''} ${item?.type || ''}`.toLowerCase();
        if (label.includes('breakfast') || label.includes('b&b') || label.includes('πρωιν')) return true;
      }
    }
  }
  return false;
}

// Tier-2: room-type-level "Breakfast included" amenity flag.
async function roomTypeBreakfastFlag(apiKey, propertyId, roomTypeId) {
  const cacheKey = `${apiKey.slice(0, 8)}:${propertyId}:${roomTypeId}`;
  if (roomBreakfastCache.has(cacheKey)) return roomBreakfastCache.get(cacheKey);
  let flag = false;
  try {
    const room = await lodgifyGet(`${V1}/properties/${propertyId}/rooms/${roomTypeId}`, apiKey);
    flag = room?.amenities?.breakfast_included === true || room?.breakfast_included === true;
  } catch {
    flag = false;  // fail closed — an API hiccup must not grant breakfast
  }
  roomBreakfastCache.set(cacheKey, flag);
  return flag;
}

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncLodgify(room, { lookbackDays, forwardDays }) {
  const logId   = await startLog(room.id, 'lodgify');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const apiKey = room.stores?.api_key_secret;
  if (!apiKey) {
    const err = 'No Lodgify API key on linked store (api_key_secret) — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'lodgify', error: err };
  }

  const ids = parsePlatformId(room.platform_id);
  if (!ids) {
    const err = `Invalid Lodgify platform_id "${room.platform_id}" — expected "propertyId:roomTypeId"`;
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'lodgify', error: err };
  }

  try {
    const cacheKey = `${room.store_id}:${fromIso}:${toIso}`;
    let allBookings = bookingsCache.get(cacheKey);
    if (!allBookings) {
      allBookings = await fetchAllBookings(apiKey);
      bookingsCache.set(cacheKey, allBookings);
    }

    // Client-side filter: this property + this room type.
    const ours = allBookings.filter(b =>
      String(b?.property_id) === ids.propertyId &&
      (Array.isArray(b?.rooms) ? b.rooms : []).some(r => String(r?.room_type_id) === ids.roomTypeId)
    );

    const typeFlag = await roomTypeBreakfastFlag(apiKey, ids.propertyId, ids.roomTypeId);

    const rawResponse = {
      window: { from: fromIso, to: toIso },
      total_bookings_in_response: allBookings.length,
      filtered_for_this_room: ours.length,
      room_type_breakfast_flag: typeFlag,
      sample_first_booking: ours[0] ? { ...ours[0], transactions: undefined } : null,
    };

    const stats = await upsertBookings(room, 'lodgify', ours, (b) => {
      const matched = (Array.isArray(b.rooms) ? b.rooms : [])
        .find(r => String(r?.room_type_id) === ids.roomTypeId);
      const gb = matched?.guest_breakdown || b?.guest_breakdown || {};
      const guests =
        ((parseInt(gb.adults ?? 0, 10) || 0) +
         (parseInt(gb.children ?? 0, 10) || 0) +
         (parseInt(gb.infants ?? 0, 10) || 0)) ||
        (parseInt(b.people ?? 0, 10) || 0) || 1;

      const statusRaw = String(b.status || '').trim().toLowerCase();
      const cancelled = statusRaw !== 'booked' || Boolean(b.canceled_at) || b.is_deleted === true;

      return {
        external_id:        String(b.id || ''),
        room_code:          String(room.platform_id || ''),
        check_in:           String(b.arrival || '').slice(0, 10),
        check_out:          String(b.departure || '').slice(0, 10),
        guest_count:        guests,
        breakfast_included: bookingHasBreakfastAddon(b) || typeFlag,
        status:             cancelled ? 'cancelled' : 'confirmed',
        raw_data:           b,
      };
    }, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats, null, rawResponse);
    return { room_id: room.id, name: room.name, provider: 'lodgify', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message, { exception: err.message, stack: (err.stack || '').slice(0, 1000) });
    return { room_id: room.id, name: room.name, provider: 'lodgify', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchLodgifyListings(store) {
  const apiKey = store.api_key_secret;
  if (!apiKey) {
    throw new Error('No Lodgify API key set on this store. Add it (under "API Key Secret") in Store settings.');
  }

  const data = await lodgifyGet(`${V1}/properties`, apiKey);
  const properties = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

  const listings = [];
  for (const p of properties) {
    const roomTypes = Array.isArray(p?.rooms) ? p.rooms : [];
    for (const rt of roomTypes) {
      if (p?.id == null || rt?.id == null) continue;
      // Enrich with per-type details (capacity, units, breakfast flag).
      let details = null;
      try {
        details = await lodgifyGet(`${V1}/properties/${p.id}/rooms/${rt.id}`, apiKey);
      } catch { /* listing still usable without details */ }
      const units = details?.units;
      const multiUnit = Number.isFinite(units) && units > 1 ? ` (${units} units — not individually trackable)` : '';
      listings.push({
        platform_id: `${p.id}:${rt.id}`,
        name:        `${p.name || `Property ${p.id}`} — ${rt.name || details?.name || `Room type ${rt.id}`}${multiUnit}`,
        capacity:    details?.max_people ?? null,
        platform:    'lodgify',
      });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'lodgify' }),
  };
}
