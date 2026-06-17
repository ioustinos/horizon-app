// providers/loggia.js
// Loggia PMS integration (Webhotelier-family vacation-rental platform).
//
// Auth: x-api-key header. The same key + page_id pair scopes the API to a
// single account's worth of properties; one Horizon store == one Loggia
// page_id. Discovered 2026-06-15 via vendor-provided Postman collection
// (saved at vendor-docs/loggia-properties-api.postman_collection.json) —
// other auth variants (Bearer, query-param) return HTTP 500.
//
// Store schema:
//   api_key_name   : Loggia page_id (numeric string, e.g. "4634")
//   api_key_secret : Loggia API key
//
// Base: https://api.loggia.net
//
// Listings: GET /api/builder/properties/manager/list/data/v2?page_id=X
//   Returns all properties under the page_id. We map each property to a
//   Horizon room. platform_id = property id (we look for `id`, `property_id`,
//   or `propertyId`, tolerant of shape variations).
//
// Sync: GET /api/lodge/bookings/list?page_id=X&main_filter=all_properties
//        &date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&date_year=YYYY
//        &source_types=all
//   Returns reservations across all properties for the date window. No
//   per-property server-side filter — we batch-and-cache per-store window
//   (same pattern as Hotelizer / Cloudbeds), then client-side filter by
//   matching the booking's property_id to room.platform_id.
//
// Breakfast detection: Loggia is short-stay-rental focused, where breakfast
// is rare and not modeled with traditional PMS board codes (BB/HB/FB).
// We use the per-store `meal_plan_breakfast_values` mechanism that HostHub
// uses — keyword substring match on free-text fields of the booking. Plus
// ALWAYS / NEVER hard overrides.
//
// Status mapping: Loggia status semantics not documented; we collapse any
// "cancel"/"declined"/"expired" string to 'cancelled', everything else to
// 'confirmed'. Verify against real payloads and refine.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
  supabase,
} from './_shared.js';

const BASE_URL = 'https://api.loggia.net';

// Module-level cache: `${store_id}:${fromIso}:${toIso}` → reservations[].
// Survives within a warm Lambda container. Same pattern as Hotelizer.
const reservationsCache = new Map();
// Per-store cache: `${store_id}` → properties[]. Used for property name
// hydration when bookings reference a property by id only.
const propertiesCache = new Map();

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncLoggia(room, { lookbackDays, forwardDays }) {
  const logId = await startLog(room.id, 'loggia');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const store = room.stores;
  const pageId = store?.api_key_name;
  const apiKey = store?.api_key_secret;
  if (!pageId || !apiKey) {
    const err = 'Missing api_key_name (page_id) or api_key_secret (API key) on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'loggia', error: err };
  }

  try {
    const cacheKey = `${room.store_id}:${fromIso}:${toIso}`;
    let allReservations = reservationsCache.get(cacheKey);
    if (!allReservations) {
      allReservations = await fetchBookingsList({ apiKey, pageId }, fromIso, toIso);
      reservationsCache.set(cacheKey, allReservations);
    }

    // Filter to this room. Match by property identifier — bookings expose
    // it under one of several common names depending on the endpoint.
    const ours = allReservations.filter(r => bookingMatchesRoom(r, room.platform_id));

    const breakfastAllowlist = parseAllowlist(store?.meal_plan_breakfast_values);
    const transform = (r) => transformBooking(r, room, breakfastAllowlist);

    const stats = await upsertBookings(room, 'loggia', ours, transform, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'loggia', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'loggia', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchLoggiaListings(store) {
  const pageId = store.api_key_name;
  const apiKey = store.api_key_secret;
  if (!pageId || !apiKey) {
    throw new Error('No Loggia credentials on this store. Add page_id (api_key_name) and API key (api_key_secret) in Store settings.');
  }

  const properties = await fetchPropertiesList({ apiKey, pageId });
  // Stash so sync calls can re-use without an extra fetch.
  propertiesCache.set(store.id, properties);

  const listings = properties
    .map(p => {
      const platform_id = String(propertyId(p) ?? '');
      if (!platform_id) return null;
      const name = String(p.property_title ?? p.name ?? p.title ?? p.property_name ?? p.property_moto ?? p.moto ?? `Property ${platform_id}`);
      const capacity = Number(p.capacity ?? p.max_guests ?? p.maxGuests ?? p.guests ?? 0) || null;
      return { platform_id, name, capacity, platform: 'loggia' };
    })
    .filter(Boolean);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'loggia', page_id: pageId }),
  };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────
async function fetchPropertiesList({ apiKey, pageId }) {
  const url = `${BASE_URL}/api/builder/properties/manager/list/data/v2?page_id=${encodeURIComponent(pageId)}`;
  const json = await loggiaGet(url, apiKey);
  // Loggia response shape isn't documented — be tolerant of several common
  // wrappers: { data: [...] } / { properties: [...] } / { items: [...] } / plain [...].
  return extractArray(json);
}

async function fetchBookingsList({ apiKey, pageId }, fromIso, toIso) {
  const dateYear = String(fromIso.slice(0, 4));
  const params = new URLSearchParams({
    page_id:      String(pageId),
    main_filter:  'all_properties',
    date_from:    fromIso,
    date_to:      toIso,
    date_year:    dateYear,
    source_types: 'all',
  });
  const url = `${BASE_URL}/api/lodge/bookings/list?${params.toString()}`;
  const json = await loggiaGet(url, apiKey);
  return extractArray(json);
}

// Single GET wrapper with AbortController timeout, mirroring the cloudbeds
// pattern (background functions have a 15-min cap, but we don't want a
// single hung call to swallow it).
async function loggiaGet(url, apiKey) {
  const FETCH_TIMEOUT_MS = 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`Loggia API timeout (>${FETCH_TIMEOUT_MS/1000}s) on ${url}`);
    }
    throw e;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Loggia API error ${res.status} on ${url}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Transforms ─────────────────────────────────────────────────────────────
function transformBooking(r, room, breakfastAllowlist) {
  const external_id = String(r.id ?? r.booking_id ?? r.bookingId ?? r.uuid ?? '');
  const check_in    = toIsoDate(r.checkin ?? r.check_in ?? r.checkIn ?? r.arrival ?? r.date_from ?? '');
  const check_out   = toIsoDate(r.checkout ?? r.check_out ?? r.checkOut ?? r.departure ?? r.date_to ?? '');
  const adults      = parseInt(r.adults ?? 0, 10);
  const kids        = parseInt(r.kids ?? r.children ?? 0, 10);
  const infants     = parseInt(r.infants ?? 0, 10);
  const guests      = (adults + kids + infants) || parseInt(r.guests ?? r.guest_count ?? 1, 10) || 1;

  const statusRaw = String(r.status ?? r.booking_status ?? r.state ?? '').toLowerCase().trim();
  const status = (/cancel|declined|expired|no.?show|rejected/.test(statusRaw))
    ? 'cancelled' : 'confirmed';

  const breakfast = resolveBreakfast(r, breakfastAllowlist);

  return {
    external_id,
    room_code:          String(propertyOnBooking(r) ?? room.platform_id ?? ''),
    check_in,
    check_out,
    guest_count:        guests,
    breakfast_included: !!breakfast,
    status,
    raw_data:           r,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function propertyId(p) {
  return p?.id ?? p?.property_id ?? p?.propertyId ?? p?.uuid ?? null;
}
function propertyOnBooking(b) {
  return b?.property_id ?? b?.propertyId ?? b?.property?.id ?? b?.property_uuid ?? null;
}
function bookingMatchesRoom(b, roomPlatformId) {
  const pid = propertyOnBooking(b);
  if (pid == null) return false;
  return String(pid).trim() === String(roomPlatformId).trim();
}
function extractArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data))       return json.data;
  if (Array.isArray(json?.properties)) return json.properties;
  if (Array.isArray(json?.items))      return json.items;
  if (Array.isArray(json?.bookings))   return json.bookings;
  if (Array.isArray(json?.results))    return json.results;
  return [];
}
function toIsoDate(s) {
  if (!s || typeof s !== 'string') return '';
  return s.slice(0, 10);
}
function parseAllowlist(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  }
  return null;
}
function resolveBreakfast(r, allowlist) {
  if (Array.isArray(allowlist) && allowlist.length) {
    const upper = allowlist.map(s => s.toUpperCase());
    if (upper.includes('ALWAYS')) return true;
    if (upper.includes('NEVER'))  return false;
    // Keyword substring match across free-text fields on the booking.
    const fields = [
      r.rate_plan, r.ratePlan, r.rate_plan_name, r.ratePlanName,
      r.notes, r.comment, r.special_request, r.meal_plan, r.mealPlan,
      r.tags, r.label,
    ];
    const hay = fields.filter(Boolean).map(x => String(x).toLowerCase()).join(' ');
    return allowlist.some(k => k && hay.includes(String(k).toLowerCase()));
  }
  // Default for vacation rentals: no breakfast unless property explicitly
  // configures it via the allowlist or ALWAYS override.
  return false;
}

void supabase;
