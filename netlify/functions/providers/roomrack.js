// providers/roomrack.js
// RoomRack PMS integration (https://docs.roomrack.gr).
//
// Auth: ?ApiToken={api_key_secret}  (query param, NOT a header)
//   The token is per-property and is enabled in the RoomRack PMS at:
//   Setup → Device Interface → General/Partners API.
//   We store the token in the linked store's `api_key_secret` field.
//   `api_key_name` is unused for RoomRack (no username concept).
//
// Sync uses the Partners API GetReservations endpoint:
//   GET https://pms.abouthotelier.com/api/RoomRackAPI/GetReservations
//        ?ApiToken=...
//        &From=dd-MM-yyyy
//        &To=dd-MM-yyyy
//        &DateCheckType=0           (Stay — return reservations overlapping the window)
//        &RoomNumber={platform_id}  (server-side filter to this room only)
//        &TCO=1                     (include reservations whose checkout = From)
// Maximum date range per call is 190 days. Our default 30 lookback + 90
// forward = 120 days, well under the cap.
//
// Listings uses the Partners API GetAllRooms endpoint:
//   GET https://pms.abouthotelier.com/api/RoomRackAPI/GetAllRooms?ApiToken=...
//
// Breakfast detection: each reservation's `board` field carries the meal
// plan (BB / HB / FB / AI / RO etc.). We map that directly — no per-store
// allowlist required.
//
// Status mapping: res_status ∈ {Confirmed, Unconfirmed, Checked-in,
// Checked-out, Cancelled, No-Show}. Cancelled and No-Show map to
// 'cancelled'; everything else maps to 'confirmed' (consistent with how
// HostHub and WebHotelier are mapped — anything not actively cancelled
// counts).

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
} from './_shared.js';

const BASE_URL = 'https://pms.abouthotelier.com/api/RoomRackAPI';

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncRoomRack(room, { lookbackDays, forwardDays }) {
  const logId    = await startLog(room.id, 'roomrack');
  const dateFromIso = offsetDate(-lookbackDays);
  const dateToIso   = offsetDate(forwardDays);

  const apiToken = room.stores?.api_key_secret;
  if (!apiToken) {
    const err = 'No API token found on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'roomrack', error: err };
  }

  try {
    // RoomRack expects dates as dd-MM-yyyy.
    const From = isoToDdMmYyyy(dateFromIso);
    const To   = isoToDdMmYyyy(dateToIso);

    const params = new URLSearchParams({
      ApiToken: apiToken,
      From,
      To,
      DateCheckType: '0',  // 0 = Stay (overlapping window). Matches our intent.
      TCO: '1',            // Include checkouts whose checkout-date = From.
    });
    if (room.platform_id) {
      params.set('RoomNumber', String(room.platform_id));
    }

    const res = await fetch(`${BASE_URL}/GetReservations?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`RoomRack API error ${res.status}: ${await res.text()}`);

    const text = await res.text();
    if (!text || !text.trim()) throw new Error('RoomRack API returned empty response');

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`RoomRack API returned invalid JSON (${text.length} chars): ${parseErr.message}`);
    }

    // The API may return a bare array OR an object wrapping the array.
    let reservations = Array.isArray(data) ? data
      : (data?.reservations || data?.data?.reservations || data?.data || []);
    if (!Array.isArray(reservations)) reservations = [];

    // Belt-and-braces: we already pass RoomNumber, but defend against the
    // server returning extras by filtering client-side too.
    if (room.platform_id) {
      reservations = reservations.filter(r =>
        String(r.room_number ?? '').trim() === String(room.platform_id).trim()
      );
    }

    const rawResponse = {
      url: res.url,
      http_status: res.status,
      total_reservations_in_response: Array.isArray(data) ? data.length : (data?.reservations?.length || 0),
      filtered_for_this_room: reservations.length,
      sample_first_reservation: reservations[0] || null,
    };

    const stats = await upsertBookings(room, 'roomrack', reservations, (b) => {
      const adults   = parseInt(b.adults   ?? 0, 10);
      const children = parseInt(b.children ?? 0, 10);
      const infants  = parseInt(b.infants  ?? 0, 10);
      const guests   = (adults + children + infants) || 1;

      const statusRaw = String(b.res_status || '').trim().toLowerCase();
      const status = (statusRaw === 'cancelled' || statusRaw === 'no-show')
        ? 'cancelled'
        : 'confirmed';

      return {
        external_id:        String(b.resid || b.ota_booking_ref || ''),
        room_code:          String(b.room_number || room.platform_id || ''),
        check_in:           parseRoomRackDateToIso(b.checkin),
        check_out:          parseRoomRackDateToIso(b.checkout),
        guest_count:        guests,
        breakfast_included: boardIncludesBreakfast(b.board),
        status,
        raw_data:           b,
      };
    }, dateFromIso);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats, null, rawResponse);
    return { room_id: room.id, name: room.name, provider: 'roomrack', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message, { exception: err.message, stack: (err.stack || '').slice(0, 1000) });
    return { room_id: room.id, name: room.name, provider: 'roomrack', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchRoomRackListings(store) {
  const apiToken = store.api_key_secret;
  if (!apiToken) {
    throw new Error('No API token set on this store. Add it (under "API Key Secret") in Store settings.');
  }

  const res = await fetch(
    `${BASE_URL}/GetAllRooms?ApiToken=${encodeURIComponent(apiToken)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) {
    throw new Error(`RoomRack API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const rooms = Array.isArray(data) ? data
    : (data?.rooms || data?.data?.rooms || data?.data || []);

  const listings = (Array.isArray(rooms) ? rooms : []).map(r => ({
    // We use room_number as the platform_id because that's what filters
    // GetReservations server-side and identifies the unit operationally.
    platform_id: String(r.room_number ?? r.room_id ?? ''),
    name:        r.room_category_name || r.name || `Room ${r.room_number ?? r.room_id ?? ''}`,
    capacity:    r.max_persons ?? r.capacity ?? null,
    platform:    'roomrack',
  })).filter(l => l.platform_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'roomrack' }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// 'YYYY-MM-DD' → 'DD-MM-YYYY' (RoomRack's expected From/To format).
function isoToDdMmYyyy(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}-${m}-${y}`;
}

// 'DD/MM/YYYY HH:MM' → 'YYYY-MM-DD' (date only, time discarded — matches
// what HostHub/WebHotelier already store).
function parseRoomRackDateToIso(s) {
  if (!s || typeof s !== 'string') return '';
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// Map RoomRack `board` → breakfast included? (boolean)
//
// Standard PMS / channel-manager codes:
//   RO / OB / BO       Room Only / no board    → no breakfast
//   BB / B&B           Bed & Breakfast         → breakfast
//   HB                 Half Board              → breakfast + dinner
//   FB                 Full Board              → all 3 meals
//   AI / UAI           (Ultra) All Inclusive   → all meals + drinks
//
// Greek free-text fallback covers properties that fill `board` with
// human-readable descriptions ('πρωινό', 'Half Board', 'Bed & Breakfast', …).
function boardIncludesBreakfast(board) {
  if (!board) return false;
  const raw = String(board).trim();
  if (!raw) return false;

  const upper = raw.toUpperCase();

  // No-board codes — explicit deny.
  if (['RO', 'OB', 'BO', 'NB', 'NONE', 'NO BOARD', 'ROOM ONLY'].includes(upper)) return false;

  // Common code prefixes that include breakfast.
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
