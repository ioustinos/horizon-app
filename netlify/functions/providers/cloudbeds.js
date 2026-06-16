// providers/cloudbeds.js
// Cloudbeds PMS API integration (https://developers.cloudbeds.com).
//
// STATUS: SCAFFOLD — Not yet exercised against a live sandbox. Auth, base URL
// and endpoint paths are taken directly from the published docs; the parsing
// of reservation payloads is best-effort and MUST be verified against a real
// `getReservationsWithRateDetails` response before this provider is enabled
// in production (registered in PROVIDERS / LISTING_PROVIDERS dispatchers).
//
// Auth: API Keys (preferred per Cloudbeds' guidance for technology partners).
//   `Authorization: Bearer cbat_xxx`  — long-lived per-property token.
//   Store schema:
//     api_key_secret : the `cbat_…` API key
//     api_key_name   : Cloudbeds propertyID (numeric) — sent on every request
//                      via the X-PROPERTY-ID header for routing performance,
//                      AND as the propertyID query param where required.
//
// Hostname: hotels.cloudbeds.com/api/v1.3
//   Cloudbeds expose two hostnames in their docs:
//     - api.cloudbeds.com/api/v1.2/{method}   (Tech Specs)
//     - hotels.cloudbeds.com/api/v1.3/{method} (API Keys Guide examples)
//   v1.3 is the current major version; v1.1 was deprecated Mar 31. We target
//   v1.3 on hotels.cloudbeds.com per the auth-flow examples. Will be verified
//   against the sandbox when access is granted.
//
// Listings: GET /getRooms returns the physical rooms in the property.
//   We store rooms.name as the platform_id (e.g. "101", "Suite A") to
//   mirror the Hotelizer / RoomRack convention.
//
// Sync: GET /getReservationsWithRateDetails?propertyID=X&checkInFrom=…&checkInTo=…
//   Returns reservations with rate-plan information per stay. We fetch the
//   full window once per store and filter client-side by roomID. To avoid N
//   redundant fetches when a store has many rooms, we cache by
//   `${store_id}:${fromIso}:${toIso}` for the warm-container lifetime
//   (same pattern as Hotelizer).
//
// Breakfast detection: combine two strategies (mirror HostHub + Hotelizer):
//   1. Rate-plan-name board prefix (BB / HB / FB / AI / UAI → breakfast)
//   2. Free-text keyword match on rate plan name (English + Greek)
//   3. Per-store override via `stores.meal_plan_breakfast_values` allowlist
//      (substring match, case-insensitive) — same column HostHub uses.
//
// Status mapping: Cloudbeds reservation `status` is one of:
//   confirmed, checked_in, checked_out, cancelled, no_show, not_confirmed.
//   We collapse to two:
//     cancelled / no_show     → 'cancelled'
//     everything else         → 'confirmed'
//   (validation downstream additionally enforces wishDate ∈ [check_in, check_out).)
//
// Rate limit: Cloudbeds enforces 10 req/sec across all endpoints. The cron
// path is one-property-per-tick and the per-property fetch is a single call
// (no per-room expansion), so we're comfortably under the cap. Adds a
// defensive sleep on 429 (`Retry-After` header respected).

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
  supabase,
} from './_shared.js';

const BASE_URL = 'https://hotels.cloudbeds.com/api/v1.3';
const PAGE_SIZE = 100;

// Module-level cache: `${store_id}:${fromIso}:${toIso}` → reservations[].
// Survives within a warm Lambda container. NOT a persistence layer.
const reservationsCache = new Map();

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncCloudbeds(room, { lookbackDays, forwardDays }) {
  const logId = await startLog(room.id, 'cloudbeds');
  const fromIso = offsetDate(-lookbackDays);
  const toIso   = offsetDate(forwardDays);

  const store = room.stores;
  const apiKey     = store?.api_key_secret;
  const propertyID = store?.api_key_name;
  if (!apiKey || !propertyID) {
    const err = 'Missing api_key_secret (cbat_ token) or api_key_name (Cloudbeds propertyID) on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'cloudbeds', error: err };
  }

  try {
    // Fetch (or reuse cached) reservations for this store + window.
    const cacheKey = `${room.store_id}:${fromIso}:${toIso}`;
    let allReservations = reservationsCache.get(cacheKey);

    if (!allReservations) {
      allReservations = await fetchAllReservationsWithRates(
        { apiKey, propertyID },
        { checkInFrom: fromIso, checkInTo: toIso }
      );
      reservationsCache.set(cacheKey, allReservations);
    }

    // Client-side filter to just this room. Match on room name (which we
    // store as platform_id), since reservations carry room assignment under
    // `assigned.rooms[].roomName` (or similar — verify when we have a real
    // payload).
    const ours = allReservations.filter(r => reservationCoversRoom(r, room.platform_id));

    // Breakfast detection context: per-store keyword allowlist (HostHub-shared
    // convention). Empty allowlist = use the board-prefix + keyword fallback.
    const breakfastAllowlist = parseAllowlist(store?.meal_plan_breakfast_values);
    const transform = (r) => transformReservation(r, room.platform_id, breakfastAllowlist);

    const stats = await upsertBookings(room, 'cloudbeds', ours, transform, fromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'cloudbeds', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'cloudbeds', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchCloudbedsListings(store) {
  const apiKey     = store.api_key_secret;
  const propertyID = store.api_key_name;
  if (!apiKey || !propertyID) {
    throw new Error('No Cloudbeds credentials set on this store. Add the cbat_ API key (api_key_secret) and the Cloudbeds propertyID (api_key_name) in Store settings.');
  }

  const rooms = await cloudbedsGet(`${BASE_URL}/getRooms`, { apiKey, propertyID }, { propertyID });

  // Cloudbeds returns rooms as `{ data: [{ propertyID, rooms: [{ roomID, roomName, roomTypeName, ... }] }] }`
  // or `{ data: [{ roomID, ... }] }`. Defensive flatten.
  const flat = flattenRoomsResponse(rooms);

  const listings = flat
    .filter(r => r.roomName)
    .map(r => ({
      platform_id: String(r.roomName ?? r.roomID ?? ''),
      name: `Room ${r.roomName}${r.roomTypeName ? ` (${r.roomTypeName})` : ''}`,
      capacity: r.maxGuests ?? r.maxOccupancy ?? null,
      platform: 'cloudbeds',
    }))
    .filter(l => l.platform_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'cloudbeds' }),
  };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchAllReservationsWithRates(creds, { checkInFrom, checkInTo }) {
  // Cloudbeds paginates via `pageNumber` (1-based) and `pageSize`. The
  // response shape is `{ success, data: [...], total, count }` — verify in
  // sandbox; some endpoints use `meta.pagination` instead.
  const all = [];
  let page = 1;
  // Hard upper bound to prevent runaway loops if pagination metadata is
  // missing — at PAGE_SIZE=100 this caps the window at 10k reservations.
  const MAX_PAGES = 100;

  while (page <= MAX_PAGES) {
    const json = await cloudbedsGet(
      `${BASE_URL}/getReservationsWithRateDetails`,
      creds,
      {
        propertyID: creds.propertyID,
        checkInFrom,
        checkInTo,
        pageNumber: page,
        pageSize: PAGE_SIZE,
        // Optional but recommended — only include actionable statuses.
        // Verify exact accepted values in sandbox.
        // status: 'confirmed,checked_in,checked_out',
      }
    );

    const rows = Array.isArray(json?.data) ? json.data : [];
    all.push(...rows);

    // Stop when the page is short — the explicit `total` field is also
    // checked when present.
    const total = Number(json?.total ?? json?.count ?? NaN);
    if (rows.length < PAGE_SIZE) break;
    if (Number.isFinite(total) && all.length >= total) break;
    page += 1;
  }

  return all;
}

// Single GET wrapper. Handles auth header, X-PROPERTY-ID, 429 backoff, error
// surfacing. Cloudbeds returns JSON with `{ success, message?, data }`.
async function cloudbedsGet(url, { apiKey, propertyID }, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const fullUrl = qs.toString() ? `${url}?${qs.toString()}` : url;

  // Defensive timeout: even with background functions (15-min platform cap),
  // a single hung Cloudbeds call shouldn't block the rest of the cron. 120s
  // is comfortably above the slowest observed response (~13s) but well under
  // the platform limit.
  const FETCH_TIMEOUT_MS = 120000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-PROPERTY-ID': String(propertyID),
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        throw new Error(`Cloudbeds API timeout (>${FETCH_TIMEOUT_MS/1000}s) on ${url}`);
      }
      throw e;
    }
    clearTimeout(timer);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
      await sleep(Math.max(500, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloudbeds API error ${res.status} on ${url}: ${text.slice(0, 300)}`);
    }

    const json = await res.json();
    if (json && json.success === false) {
      const msg = json.message || json.error || 'success=false';
      throw new Error(`Cloudbeds API returned success=false on ${url}: ${String(msg).slice(0, 300)}`);
    }
    return json;
  }
  throw new Error(`Cloudbeds API: rate-limited after 3 attempts on ${url}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Transforms ──────────────────────────────────────────────────────────────

// Best-effort mapping of a Cloudbeds reservation to Horizon's bookings row.
// Field paths below are derived from Cloudbeds public docs / examples; some
// may need adjustment once we see a real `getReservationsWithRateDetails`
// payload in the sandbox.
function transformReservation(r, roomPlatformId, breakfastAllowlist) {
  // Real Cloudbeds getReservationsWithRateDetails response shape, verified
  // against the sandbox on 2026-06-02:
  //   reservation = {
  //     reservationID, reservationCheckIn, reservationCheckOut, status,
  //     guestID, guestName, propertyID, mealPlans (top-level string),
  //     rooms: [
  //       { roomID, roomName, roomTypeID, roomTypeName, rateID, rateName,
  //         ratePlanNamePrivate, ratePlanNamePublic, adults (string),
  //         children (string), roomCheckIn, roomCheckOut, roomStatus, ... }
  //     ]
  //   }
  // Field names that bit our first scaffold (kept as fallbacks for future
  // endpoint variants): r.checkIn / r.checkOut / r.adults / r.children /
  // ourRoom.ratePlanName.
  const external_id = String(r.reservationID ?? r.reservationId ?? r.id ?? '');

  // Find the room assignment that matches our physical room (Horizon's
  // platform_id = Cloudbeds roomName like "DK(8)").
  const assignedRooms = extractAssignedRooms(r);
  const ourRoom = assignedRooms.find(a => sameRoom(a, roomPlatformId)) || assignedRooms[0] || {};

  // Stay window — prefer per-room dates (can differ from reservation-level
  // when a long booking is split across rooms with staggered nights).
  const check_in  = toIsoDate(ourRoom.roomCheckIn  ?? r.reservationCheckIn  ?? r.checkIn  ?? r.startDate);
  const check_out = toIsoDate(ourRoom.roomCheckOut ?? r.reservationCheckOut ?? r.checkOut ?? r.endDate);

  // Guest count — per-room on Cloudbeds. Values come back as strings ("1",
  // "0"), hence parseInt. One Horizon room maps to one Cloudbeds physical
  // room, so we use the matched room's counts only.
  const adults   = parseInt(ourRoom.adults   ?? r.adults   ?? 0, 10);
  const children = parseInt(ourRoom.children ?? r.children ?? 0, 10);
  const guests   = (adults + children) || 1;

  // Status mapping. Cloudbeds top-level `status` values seen: confirmed,
  // checked_in, checked_out, cancelled, no_show, not_confirmed.
  const rawStatus = String(r.status ?? '').toLowerCase();
  const status = (rawStatus === 'cancelled' || rawStatus === 'canceled' || rawStatus === 'no_show' || rawStatus === 'noshow')
    ? 'cancelled'
    : 'confirmed';

  // Rate-plan name candidates on the matched room. Public > private > rateName
  // is the right precedence — `rateName` is often the internal short label
  // (e.g. "Deluxe King"), `ratePlanNamePublic` is what the guest sees
  // (e.g. "Bed & Breakfast"). Both can be null in the sandbox; we keep
  // ratePlanName as a defensive fallback for any endpoint variant that
  // exposes a top-level field.
  const ratePlanName = ourRoom.ratePlanNamePublic
                    ?? ourRoom.ratePlanNamePrivate
                    ?? ourRoom.rateName
                    ?? ourRoom.ratePlanName
                    ?? r.ratePlanName
                    ?? '';

  const roomCode = ourRoom.roomName ?? '';

  // ── Breakfast detection ──────────────────────────────────────────────────
  // Primary signal (verified on 2026-06-02 against real payload): top-level
  // `reservation.mealPlans` is a string field that IS persisted on
  // getReservationsWithRateDetails responses. In the sandbox sample it was
  // empty because the demo property hasn't been configured with meal plans,
  // but the field exists and is the documented source of truth.
  //
  // We treat any of these keyword matches (case-insensitive substring) as
  // breakfast included: 'breakfast', 'half board', 'full board',
  // 'all inclusive', plus the camel/snake-case variants Cloudbeds uses
  // internally (halfBoard, fullBoard, allInclusive).
  const mealPlansStr = String(r.mealPlans ?? '').toLowerCase();
  const MEAL_PLAN_BREAKFAST_KEYWORDS = [
    'breakfast', 'half board', 'halfboard', 'half_board',
    'full board', 'fullboard', 'full_board',
    'all inclusive', 'allinclusive', 'all_inclusive',
  ];
  const mealPlansSaysBreakfast = mealPlansStr.length > 0
    && MEAL_PLAN_BREAKFAST_KEYWORDS.some(kw => mealPlansStr.includes(kw));

  // Secondary signals (existing) — rate-plan name + per-store allowlist.
  // If mealPlans is empty (likely the common case in this sandbox), fall
  // back to checking the rate plan name for the same keywords.
  const breakfast = mealPlansSaysBreakfast
    || matchesAllowlist(ratePlanName, breakfastAllowlist)
    || boardIncludesBreakfast(ratePlanName);

  return {
    external_id,
    room_code:          String(roomCode),
    check_in,
    check_out,
    guest_count:        guests,
    breakfast_included: !!breakfast,
    status,
    raw_data:           r,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Return true if any room assignment on this reservation matches our
// physical-room platform_id.
function reservationCoversRoom(reservation, roomPlatformId) {
  const assigned = extractAssignedRooms(reservation);
  return assigned.some(a => sameRoom(a, roomPlatformId));
}

function sameRoom(assignment, roomPlatformId) {
  const target = String(roomPlatformId).trim();
  return [assignment.roomName, assignment.roomID, assignment.roomId]
    .some(v => v !== undefined && v !== null && String(v).trim() === target);
}

// Normalize the `rooms` / `assigned` array from a reservation regardless of
// whether Cloudbeds nests it under `rooms`, `assigned`, `roomAssignments`,
// or returns it flat. Verify when we have a real payload.
function extractAssignedRooms(r) {
  if (Array.isArray(r?.rooms))            return r.rooms;
  if (Array.isArray(r?.assigned))         return r.assigned;
  if (Array.isArray(r?.roomAssignments))  return r.roomAssignments;
  // Flat single-room fallback.
  if (r?.roomID || r?.roomName) {
    return [{
      roomID:       r.roomID,
      roomName:     r.roomName,
      ratePlanName: r.ratePlanName,
      ratePlanID:   r.ratePlanID,
    }];
  }
  return [];
}

function flattenRoomsResponse(json) {
  // getRooms can come back as `{ data: [{ propertyID, rooms: [...] }] }`
  // (multi-property) or `{ data: [...] }` (single property).
  const outer = Array.isArray(json?.data) ? json.data : [];
  const flat = [];
  for (const node of outer) {
    if (Array.isArray(node?.rooms)) flat.push(...node.rooms);
    else flat.push(node);
  }
  return flat;
}

function toIsoDate(s) {
  if (!s) return '';
  const str = String(s);
  // Accept both `YYYY-MM-DD` and `YYYY-MM-DD HH:MM:SS` — return date portion.
  return str.slice(0, 10);
}

function parseAllowlist(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(s => String(s).toLowerCase()).filter(Boolean);
  return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function matchesAllowlist(text, allowlist) {
  if (!allowlist?.length || !text) return false;
  const lower = String(text).toLowerCase();
  return allowlist.some(kw => lower.includes(kw));
}

// Shared board-basis detector (mirror Hotelizer / RoomRack).
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
    lower.includes('πρωιν')
  ) {
    return true;
  }
  return false;
}

void supabase;
