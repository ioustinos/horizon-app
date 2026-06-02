// providers/guesty.js
// Guesty Open API integration (https://open-api-docs.guesty.com).
//
// STATUS: SCAFFOLD — Not exercised against a live sandbox yet. Auth, base
// URL, endpoint paths and pagination model are taken directly from the
// public Guesty Open API docs (Authentication + Rate Limits + Reservations).
// Response parsing for /v1/reservations MUST be verified against a real
// payload before this provider is enabled in production (UI exposure).
//
// Auth: OAuth 2.0 client_credentials grant. Property owner generates
//   Client ID + Client Secret in their Guesty dashboard.
//     POST https://open-api.guesty.com/oauth2/token
//     form: grant_type=client_credentials, scope=open-api,
//           client_id=..., client_secret=...
//     → { access_token, expires_in (seconds, 24h), token_type, scope }
//   We cache the token in module-scope per (client_id, client_secret) and
//   reuse until 60 seconds before expiry.
//
// Store schema:
//   api_key_name   : Guesty Client ID
//   api_key_secret : Guesty Client Secret
//
// Base: https://open-api.guesty.com
//
// Listings: GET /v1/listings
//   We map each Guesty listing to a Horizon room. platform_id = the Guesty
//   listing _id (Mongo ObjectId style string). Mirror Lodgify pattern.
//
// Sync: GET /v1/reservations
//   Filters via the `filters` query param (array of objects). Typical:
//     filters[]={"field":"checkInDateLocal","operator":"$between",
//                "from":"2026-05-01","to":"2026-09-01"}
//     filters[]={"field":"listingId","operator":"$eq","value":"<id>"}
//   For efficiency we fetch once per property+window (listingId-less) and
//   filter client-side by listingId — same caching pattern as Hotelizer /
//   Lodgify. Switch to per-listing if a single-property has too many
//   reservations to fit a single response.
//   Pagination: `skip` + `limit` (max 100). Walk until response is short.
//
// Status mapping (Guesty `status` → Horizon):
//   inquiry / canceled / declined / expired → 'cancelled'
//   confirmed / reserved / booked / checked_in / checked_out → 'confirmed'
//   (verify exact enum values vs sandbox; Guesty docs use a couple of
//   different vocabularies across endpoints).
//
// Rate limits (per Guesty docs):
//   15 / second, 120 / minute, 5,000 / hour.
//   On 429, honor `Retry-After` response header (seconds).
//
// ── BREAKFAST DETECTION ─────────────────────────────────────────────────────
// VERIFIED (2026-06-02): `reservation.ratePlan.mealPlans` is NOT returned on
// the standard GET /v1/reservations response. Three pieces of evidence:
//   1. "How to Search for Reservations" guide field table doesn't list it.
//   2. "Reservation Webhooks" page (full payload schema) doesn't mention it.
//   3. The V3 booking-flow JSON example showing mealPlans is from a QUOTE
//      response (pre-checkout), not a saved reservation.
//
// PRIMARY signal: the listing-level `breakfast` amenity, documented in the
// Supported Amenities catalog (Kitchen & Dining group, channel-mapped to
// Booking.com / Expedia / Marriott). We read this at room-mapping time and
// stamp each Horizon room with whether the linked listing offers breakfast.
//
// FALLBACK: per-store override via stores.meal_plan_breakfast_values:
//   - empty / null → use whatever the listing amenity says
//   - 'ALWAYS'      → force breakfast=true on every booking
//   - 'NEVER'       → force breakfast=false on every booking
//
// OPEN: per-stay add-ons / additional fees / custom fields aren't checked
// yet — the docs don't make clear which (if any) of these is the idiomatic
// place. To be resolved once Guesty integrations contact responds to the
// scoping email; updating the detector is then localized to
// `reservationIncludesBreakfast()` below.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
  supabase,
} from './_shared.js';

const BASE_URL = 'https://open-api.guesty.com';
const PAGE_SIZE = 100;

// Token cache: `${client_id}` → { token, expiresAt }
const tokenCache = new Map();
// Reservations cache: `${store_id}:${fromIso}:${toIso}` → reservations[]
const reservationsCache = new Map();

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncGuesty(room, { lookbackDays, forwardDays }) {
  const logId = await startLog(room.id, 'guesty');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const store = room.stores;
  const clientId     = store?.api_key_name;
  const clientSecret = store?.api_key_secret;
  if (!clientId || !clientSecret) {
    const err = 'Missing api_key_name (Guesty Client ID) or api_key_secret (Client Secret) on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'guesty', error: err };
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);

    const cacheKey = `${room.store_id}:${fromIso}:${toIso}`;
    let allReservations = reservationsCache.get(cacheKey);

    if (!allReservations) {
      allReservations = await fetchAllReservations(token, { fromIso, toIso });
      reservationsCache.set(cacheKey, allReservations);
    }

    // Client-side filter to this listing. room.platform_id should equal
    // the Guesty listing _id.
    const ours = allReservations.filter(r => sameListing(r, room.platform_id));

    const transform = (r) => transformReservation(r, room.platform_id, store);

    const stats = await upsertBookings(room, 'guesty', ours, transform, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'guesty', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'guesty', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchGuestyListings(store) {
  const clientId     = store.api_key_name;
  const clientSecret = store.api_key_secret;
  if (!clientId || !clientSecret) {
    throw new Error('No Guesty credentials set on this store. Add Client ID (api_key_name) and Client Secret (api_key_secret) in Store settings.');
  }

  const token = await getAccessToken(clientId, clientSecret);

  // GET /v1/listings — single page is enough for most properties; if not,
  // walk pages until we hit the end (same as reservations).
  const all = await fetchAllPaged(token, '/v1/listings', {});

  const listings = all
    .map(l => ({
      platform_id: String(l._id ?? l.id ?? ''),
      name: l.title || l.nickname || `Listing ${l._id}`,
      capacity: l?.accommodates ?? l?.maxOccupancy ?? null,
      // Listing-level breakfast amenity baseline. Per the Supported Amenities
      // catalog, the canonical slug is 'breakfast'. If the listing exposes
      // amenities as an array of strings, look for that value; if as an
      // array of objects, look for { name: 'breakfast' } / { slug: 'breakfast' }.
      breakfast_baseline: listingOffersBreakfast(l),
      platform: 'guesty',
    }))
    .filter(l => l.platform_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'guesty' }),
  };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchAllReservations(token, { fromIso, toIso }) {
  // Per Guesty docs the `filters` query param expects an array of
  // JSON-encoded objects. We pass them as repeated `filters[]=<json>` so
  // URLSearchParams concatenates correctly.
  const filterValue = JSON.stringify({
    field: 'checkInDateLocal',
    operator: '$between',
    from: fromIso,
    to: toIso,
  });

  return fetchAllPaged(token, '/v1/reservations', {
    'filters[]': filterValue,
    fields: '_id status checkInDateLocal checkOutDateLocal nightsCount guestsCount listingId source money',
    sort: '-checkInDateLocal',
  });
}

async function fetchAllPaged(token, path, extraParams) {
  const all = [];
  let skip = 0;
  const MAX_PAGES = 100;

  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await guestyGet(token, path, { ...extraParams, limit: PAGE_SIZE, skip });
    const rows = Array.isArray(json?.results) ? json.results
              : (Array.isArray(json?.data) ? json.data
              : (Array.isArray(json) ? json : []));
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}

// Single GET wrapper with rate-limit aware retry.
async function guestyGet(token, path, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.append(k, String(v));
  }
  const url = `${BASE_URL}${path}${qs.toString() ? '?' + qs.toString() : ''}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
      await sleep(Math.max(500, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Guesty API error ${res.status} on ${path}: ${text.slice(0, 300)}`);
    }

    return await res.json();
  }
  throw new Error(`Guesty API: rate-limited after 3 attempts on ${path}`);
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

async function getAccessToken(clientId, clientSecret) {
  const now = Date.now();
  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    scope:         'open-api',
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Guesty OAuth token request failed ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const token = json?.access_token;
  const ttl   = parseInt(json?.expires_in ?? 86400, 10);
  if (!token) throw new Error('Guesty OAuth response missing access_token');

  tokenCache.set(clientId, { token, expiresAt: Date.now() + ttl * 1000 });
  return token;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Transforms ──────────────────────────────────────────────────────────────

function transformReservation(r, listingId, store) {
  const external_id = String(r._id ?? r.id ?? '');
  const check_in    = toIsoDate(r.checkInDateLocal ?? r.checkIn);
  const check_out   = toIsoDate(r.checkOutDateLocal ?? r.checkOut);
  const guests      = parseInt(r.guestsCount ?? 1, 10) || 1;

  // Status mapping — Guesty uses several enums depending on endpoint.
  // The conservative collapse: anything cancelled-ish → 'cancelled', rest
  // → 'confirmed'. Validation downstream still enforces wishDate ∈ stay.
  const raw = String(r.status ?? '').toLowerCase();
  const status = ['canceled', 'cancelled', 'declined', 'expired', 'inquiry']
    .includes(raw) ? 'cancelled' : 'confirmed';

  // Breakfast detection — see header. Primary signal is the listing-level
  // 'breakfast' amenity, stamped into `room.breakfast_baseline` at mapping
  // time. Per-store overrides flip the default both ways.
  const breakfast = resolveBreakfast(room, store);

  return {
    external_id,
    room_code:          String(r.listingId ?? listingId ?? ''),
    check_in,
    check_out,
    guest_count:        guests,
    breakfast_included: !!breakfast,
    status,
    raw_data:           r,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sameListing(r, listingId) {
  return String(r.listingId ?? r.listing_id ?? '') === String(listingId);
}

function toIsoDate(s) {
  if (!s) return '';
  return String(s).slice(0, 10);
}


// Resolve breakfast for a given booking using:
//   1. Per-store override (stores.meal_plan_breakfast_values 'ALWAYS' / 'NEVER')
//   2. Listing-level amenity baseline stamped on the room
//        (room.breakfast_baseline, set by fetchGuestyListings)
//   3. Conservative default: include breakfast (so we don't accidentally deny
//      a valid guest because our metadata isn't filled in).
//
// The reservation parameter is kept on the signature for future use (per-stay
// add-on / custom-field detection, once we know where Guesty exposes that).
function resolveBreakfast(room, store) {
  const flag = String(store?.meal_plan_breakfast_values ?? '').trim().toUpperCase();
  if (flag === 'ALWAYS') return true;
  if (flag === 'NEVER')  return false;
  if (typeof room?.breakfast_baseline === 'boolean') return room.breakfast_baseline;
  return true;
}


// Inspect a Guesty listing object for the 'breakfast' amenity (Supported
// Amenities catalog, Kitchen & Dining group). Tolerant of multiple shapes
// since the field can be returned as strings or objects depending on the
// query / channel mapping.
function listingOffersBreakfast(l) {
  const a = l?.amenities;
  if (!Array.isArray(a) || a.length === 0) return null;
  return a.some(item => {
    if (typeof item === 'string') return item.toLowerCase() === 'breakfast';
    if (item && typeof item === 'object') {
      const slug = String(item.slug ?? item.name ?? item.id ?? '').toLowerCase();
      return slug === 'breakfast';
    }
    return false;
  }) || null;  // false → null so resolveBreakfast falls through to conservative default
}

void supabase;
