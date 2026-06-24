// providers/hostaway.js
// Hostaway Public API integration (https://api.hostaway.com/documentation).
//
// Architecture: pull-based REST, JSON, OAuth 2.0 client_credentials.
// One Horizon store = one Hostaway account = many listings.
//
// Store schema:
//   api_key_name   : Hostaway account_id (numeric, "client_id")
//   api_key_secret : Hostaway API key (the "client_secret" issued in the
//                    Hostaway dashboard → "Get API client secret")
//
// Base URL: https://api.hostaway.com/v1
//
// Auth: POST /v1/accessTokens (form body
//   grant_type=client_credentials&client_id={account}&client_secret={key}
//   &scope=general) → { token_type: "Bearer", expires_in (sec, ~24mo),
//   access_token }. We cache per-(account, key) and re-issue only on
//   expiry. Wait 1s after issue per docs.
//
// Listings: GET /v1/listings?limit=100&offset=N — paginated. Each listing
//   has unique int `id` → room.platform_id. For multi-unit listings the
//   physical sub-units live at GET /v1/listingUnits/{listingMapId} (not
//   yet implemented — defer until a real account requires it).
//
// Sync: GET /v1/reservations?includeResources=1&arrivalStartDate=YYYY-MM-DD
//   &arrivalEndDate=YYYY-MM-DD — paginated via afterId (cursor; offset
//   deprecated 2026-03-31). includeResources=1 is required to get
//   reservationFees + customFieldValues populated. Match each reservation
//   to a room by `listingMapId` (parent listing id; we don't yet split
//   multi-unit listings).
//
// Status mapping (strict):
//   confirmed: new, modified, ownerStay
//   cancelled: cancelled, declined, expired, inquiry*, pending,
//              awaiting*, unconfirmed, unknown
//   Plus: cancellationDate != null → forced cancelled regardless of status.
//
// Breakfast detection (per the design):
//   1. Per-store override (meal_plan_breakfast_values):
//        ALWAYS → true · NEVER → false · empty → fall through
//   2. PRIMARY — listing's listingAmenities[] intersects with the dynamic
//      breakfast amenity set (derived once per cold container from
//      GET /v1/amenities by regex match on amenity.name). Cached on the
//      listing as `_hasBreakfastAmenity`.
//   3. SECONDARY — reservationFees[].name keyword scan
//      (/breakfast|meal[\s-]?included|πρωιν/i).
//   4. TERTIARY — free-text scan across hostNote, guestNote, comment,
//      bookingcomSpecialRequests.
//   5. Default false (vacation-rental baseline).
//
// Rate limits: 15 req/10s per IP, 20 req/10s per account. We don't push
// hard parallelism; pagination is sequential.
//
// Date format: YYYY-MM-DD on input + output for arrival/departure.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
  supabase,
} from './_shared.js';

const BASE_URL = 'https://api.hostaway.com/v1';
const PAGE_SIZE = 100;
const FETCH_TIMEOUT_MS = 60000;

// Module-level caches — survive within a warm Lambda container.
const tokenCache         = new Map(); // accountId → { token, expiresAt }
const listingsCache      = new Map(); // store_id  → { listings, fetched_at }
const reservationsCache  = new Map(); // `${store_id}:${fromIso}:${toIso}` → reservations[]
let breakfastAmenityIds  = null;       // Set<int> derived from /v1/amenities

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncHostaway(room, { lookbackDays, forwardDays }) {
  const logId = await startLog(room.id, 'hostaway');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const store = room.stores;
  const accountId = store?.api_key_name;
  const apiKey    = store?.api_key_secret;
  if (!accountId || !apiKey) {
    const err = 'Missing api_key_name (account_id) or api_key_secret (API key) on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'hostaway', error: err };
  }

  try {
    const token = await getAccessToken({ accountId, apiKey });

    // Ensure listings cache for the store, and derive this room's breakfast flag.
    const listings = await getCachedListings({ store, token });
    const myListing = listings.find(l => String(l.id) === String(room.platform_id));
    const listingBreakfast = !!myListing?._hasBreakfastAmenity;

    // Fetch (or reuse) reservations for store + window. Server-side filter by
    // listingId to avoid pulling all of the account's history.
    const cacheKey = `${room.store_id}:${fromIso}:${toIso}:${room.platform_id}`;
    let allReservations = reservationsCache.get(cacheKey);
    if (!allReservations) {
      allReservations = await fetchAllReservations(token, {
        arrivalStartDate: fromIso,
        arrivalEndDate:   toIso,
        listingId:        room.platform_id,
      });
      reservationsCache.set(cacheKey, allReservations);
    }

    // Match to this room. For single-unit listings (the common case),
    // listingMapId === room.platform_id. For multi-unit accounts we'd
    // additionally check reservationUnit[].listingUnitId; deferred.
    const ours = allReservations.filter(r => bookingMatchesRoom(r, room.platform_id));

    const overrideFlag = parseOverride(store?.meal_plan_breakfast_values);
    const transform = (r) => transformReservation(r, room, listingBreakfast, overrideFlag);
    const stats = await upsertBookings(room, 'hostaway', ours, transform, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'hostaway', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'hostaway', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchHostawayListings(store) {
  const accountId = store.api_key_name;
  const apiKey    = store.api_key_secret;
  if (!accountId || !apiKey) {
    throw new Error('No Hostaway credentials on this store. Add account_id (api_key_name) + API key (api_key_secret) in Store settings.');
  }

  const token = await getAccessToken({ accountId, apiKey });
  const listings = await fetchAllListings(token);
  // Cache enriched listings (with _hasBreakfastAmenity already computed) so
  // subsequent sync calls reuse them without an extra round-trip.
  await enrichListingsWithBreakfast(listings, token);
  listingsCache.set(store.id, { listings, fetched_at: Date.now() });

  const out = listings.map(l => ({
    platform_id: String(l.id ?? ''),
    name: String(l.name ?? l.externalListingName ?? l.internalListingName ?? `Listing ${l.id}`),
    capacity: Number(l.personCapacity ?? 0) || null,
    platform: 'hostaway',
  })).filter(x => x.platform_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings: out, platform: 'hostaway', account_id: accountId }),
  };
}

// ─── Helpers: token + amenities catalog ─────────────────────────────────────
async function getAccessToken({ accountId, apiKey }) {
  const cacheKey = `${accountId}`;
  const cached = tokenCache.get(cacheKey);
  // Refresh 1 day before expiry to be safe.
  if (cached && cached.expiresAt > Date.now() + 86_400_000) return cached.token;

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     String(accountId),
    client_secret: String(apiKey),
    scope:         'general',
  });
  const res = await fetch(`${BASE_URL}/accessTokens`, {
    method: 'POST',
    headers: { 'Content-type': 'application/x-www-form-urlencoded', 'Cache-control': 'no-cache' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hostaway token issue failed ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const token = json?.access_token;
  const ttlSec = Number(json?.expires_in ?? 0);
  if (!token) throw new Error(`Hostaway token response missing access_token: ${JSON.stringify(json).slice(0, 200)}`);
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + ttlSec * 1000 });
  // Per docs: wait 1s before first use of a freshly issued token.
  await sleep(1100);
  return token;
}

async function getBreakfastAmenityIds(token) {
  if (breakfastAmenityIds) return breakfastAmenityIds;
  const json = await hostawayGet(`${BASE_URL}/amenities`, token);
  const arr = extractArray(json);
  // STRICT match — only amenities whose name signals breakfast is actually
  // included. "Breakfast possible" (id 218) and "Meal delivery" (id 278)
  // are ambiguous → not auto-flagged. Properties needing them can set the
  // per-store ALWAYS override.
  const strict = /^breakfast$|meal\s*included|bed\s*and\s*breakfast|^b&b$/i;
  const ids = new Set(
    arr.filter(a => typeof a?.name === 'string' && strict.test(a.name))
       .map(a => Number(a.id))
       .filter(n => Number.isFinite(n))
  );
  breakfastAmenityIds = ids;
  return ids;
}

async function enrichListingsWithBreakfast(listings, token) {
  const bfIds = await getBreakfastAmenityIds(token);
  for (const l of listings) {
    const amenityIds = (l?.listingAmenities || []).map(a => Number(a?.amenityId)).filter(Number.isFinite);
    l._hasBreakfastAmenity = amenityIds.some(id => bfIds.has(id));
  }
}

async function getCachedListings({ store, token }) {
  const cached = listingsCache.get(store.id);
  if (cached) return cached.listings;
  const listings = await fetchAllListings(token);
  await enrichListingsWithBreakfast(listings, token);
  listingsCache.set(store.id, { listings, fetched_at: Date.now() });
  return listings;
}

// ─── Fetchers ────────────────────────────────────────────────────────────────
async function fetchAllListings(token) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE), offset: String(offset),
      includeResources: '1', // ensures listingAmenities is populated
    });
    const json = await hostawayGet(`${BASE_URL}/listings?${qs.toString()}`, token);
    const rows = extractArray(json);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function fetchAllReservations(token, { arrivalStartDate, arrivalEndDate, listingId }) {
  const all = [];
  let afterId = null;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({
      limit:            String(PAGE_SIZE),
      includeResources: '1',
      arrivalStartDate, arrivalEndDate,
      listingId:        String(listingId),
      sortOrder:        'arrivalDate',
    });
    if (afterId != null) qs.set('afterId', String(afterId));
    const json = await hostawayGet(`${BASE_URL}/reservations?${qs.toString()}`, token);
    const rows = extractArray(json);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    // afterId cursor: use the last row's id
    const last = rows[rows.length - 1];
    const nextAfter = last?.id;
    if (nextAfter == null || String(nextAfter) === String(afterId)) break;
    afterId = nextAfter;
  }
  return all;
}

async function hostawayGet(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`Hostaway timeout (>${FETCH_TIMEOUT_MS/1000}s) on ${url}`);
    throw e;
  }
  clearTimeout(timer);

  if (res.status === 429) {
    // Honour rate-limit. Brief backoff + one retry.
    await sleep(2000);
    const retry = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!retry.ok) throw new Error(`Hostaway 429 persisted on ${url}`);
    res = retry;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hostaway API error ${res.status} on ${url}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json && json.status === 'fail') {
    throw new Error(`Hostaway returned status=fail on ${url}: ${String(json.result ?? json.message ?? '').slice(0, 300)}`);
  }
  return json;
}

// ─── Transforms ─────────────────────────────────────────────────────────────
function transformReservation(r, room, listingBreakfast, overrideFlag) {
  const external_id = String(r.id ?? '');
  const check_in    = toIsoDate(r.arrivalDate ?? '');
  const check_out   = toIsoDate(r.departureDate ?? '');
  const adults      = parseInt(r.adults   ?? 0, 10);
  const children    = parseInt(r.children ?? 0, 10);
  const infants     = parseInt(r.infants  ?? 0, 10);
  const explicit    = parseInt(r.numberOfGuests ?? 0, 10);
  const guests      = explicit || (adults + children + infants) || 1;

  const statusRaw = String(r.status ?? '').toLowerCase().trim();
  const CONFIRMED = new Set(['new', 'modified', 'ownerstay']);
  const hasCancellationDate = r.cancellationDate != null && r.cancellationDate !== '';
  const status = (CONFIRMED.has(statusRaw) && !hasCancellationDate) ? 'confirmed' : 'cancelled';

  const breakfast = resolveBreakfast(r, listingBreakfast, overrideFlag);

  return {
    external_id,
    room_code:          String(r.listingMapId ?? room.platform_id ?? ''),
    check_in,
    check_out,
    guest_count:        guests,
    breakfast_included: !!breakfast,
    status,
    raw_data:           r,
  };
}

// 4-tier detection. Store override > listing amenity > fee name > free text > false.
function resolveBreakfast(r, listingBreakfast, overrideFlag) {
  if (overrideFlag === true)  return true;
  if (overrideFlag === false) return false;
  if (listingBreakfast) return true;

  // Fee-name scan
  const feeNames = (r?.reservationFees || []).map(f => String(f?.name || '')).filter(Boolean).join(' ');
  if (/breakfast|meal[\s-]?included|πρωιν/i.test(feeNames)) return true;

  // Free-text scan across notes / special requests
  const free = [
    r.hostNote, r.guestNote, r.comment,
    r.bookingcomSpecialRequests ? JSON.stringify(r.bookingcomSpecialRequests) : '',
  ].filter(Boolean).join(' ');
  if (/breakfast|πρωιν|\bbb\b|bed[\s-]and[\s-]breakfast|b&b/i.test(free)) return true;

  return false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseOverride(v) {
  if (!v) return null;
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[\n,]/) : []);
  const upper = arr.map(s => String(s).trim().toUpperCase());
  if (upper.includes('ALWAYS')) return true;
  if (upper.includes('NEVER'))  return false;
  return null;
}
function bookingMatchesRoom(r, roomPlatformId) {
  return String(r?.listingMapId ?? '').trim() === String(roomPlatformId).trim();
}
function extractArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.result)) return json.result;
  if (Array.isArray(json?.data))   return json.data;
  return [];
}
function toIsoDate(s) {
  if (!s || typeof s !== 'string') return '';
  return s.slice(0, 10);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

void supabase;
