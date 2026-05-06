// providers/webhotelier.js
// WebHotelier integration via the Reserve-Online REST API.
// Auth: HTTP Basic (api_key_name:api_key_secret from linked store).
//   - api_key_name  = property code / username (e.g. HRZNTEST)
//   - api_key_secret = API password
// Base URL: https://rest.reserve-online.net
// Booking Search:  GET /reservation?chkin_fromd=...&chkin_tod=...&verbose=2&maxrows=1000
// Listings (Rooms): GET /room/{propertycode}
//
// `room.platform_id` on a WebHotelier room is the room CODE (e.g. DBL, TRP),
// used to filter the bookings response down to this room.
//
// Breakfast detection: OpenTravel-standard board IDs.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
} from './_shared.js';

const BOOKINGS_URL  = 'https://rest.reserve-online.net/reservation';
const ROOMS_URL_TPL = 'https://rest.reserve-online.net/room';

// Board IDs that include breakfast (OpenTravel standard):
// 1=All inclusive, 2=American, 3=B&B, 4=Buffet breakfast, 5=Caribbean breakfast,
// 6=Continental, 7=English, 10=Full board, 11=Full breakfast, 12=Half board,
// 17=Dinner B&B, 18=Family American, 19=Breakfast, 23=Breakfast & lunch
const BREAKFAST_BOARD_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 17, 18, 19, 23]);

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncWebHotelier(room, { lookbackDays, forwardDays }) {
  const logId    = await startLog(room.id, 'webhotelier');
  const dateFrom = offsetDate(-lookbackDays);
  const dateTo   = offsetDate(forwardDays);

  const apiName   = room.stores?.api_key_name;
  const apiSecret = room.stores?.api_key_secret;
  if (!apiSecret || !apiName) {
    const err = 'No API credentials (username + password) found on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'webhotelier', error: err };
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(`${apiName}:${apiSecret}`).toString('base64');
    const headers = {
      Authorization: authHeader,
      Accept: 'application/json',
    };

    const res = await fetch(
      `${BOOKINGS_URL}?chkin_fromd=${dateFrom}&chkin_tod=${dateTo}&verbose=2&maxrows=1000`,
      { headers }
    );
    if (!res.ok) throw new Error(`WebHotelier API error ${res.status}: ${await res.text()}`);

    const text = await res.text();
    if (!text || !text.trim()) throw new Error('WebHotelier API returned empty response');
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`WebHotelier API returned invalid JSON (${text.length} chars): ${parseErr.message}`);
    }
    let allBookings = data?.data?.reservations || data?.data?.bookings ||
      (Array.isArray(data?.data) ? data.data : []);

    // If this room has a platform_id (room code), filter bookings to that room type.
    const roomCode = room.platform_id;
    let bookings = allBookings;
    if (roomCode) {
      bookings = allBookings.filter(b => {
        const bRoom = b.roomStay?.roomType || '';
        return String(bRoom) === String(roomCode);
      });
    }

    const stats = await upsertBookings(room, 'webhotelier', bookings, (b) => {
      const stay     = b.roomStay || {};
      const room0    = b.rooms?.[0] || {};
      const adults   = parseInt(room0.adults ?? 1, 10);
      const children = parseInt(room0.children ?? 0, 10);
      const guests   = adults + children;

      const statusCode = (b.statusCode || '').toUpperCase();
      let status = 'confirmed';
      if (statusCode === 'CANCELLED' || statusCode === 'PURGED' || b.status === 0 || b.status === '0') {
        status = 'cancelled';
      }

      const boardId = parseInt(stay.board ?? stay.boardID ?? -1, 10);
      const breakfast_included = BREAKFAST_BOARD_IDS.has(boardId);

      return {
        external_id:        String(b.id || ''),
        room_code:          String(stay.roomType || roomCode || ''),
        check_in:           stay.from || '',
        check_out:          stay.to   || '',
        guest_count:        guests,
        breakfast_included,
        status,
        raw_data:           b,
      };
    }, dateFrom);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'webhotelier', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'webhotelier', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchWebHotelierListings(store) {
  const propertyCode = store.api_key_name; // For WebHotelier, api_key_name IS the property code / username
  if (!propertyCode) {
    throw new Error('No API Key Name (property code / username) set on this store. Add it in Store settings.');
  }

  const authHeader = 'Basic ' + Buffer.from(`${propertyCode}:${store.api_key_secret}`).toString('base64');

  const res = await fetch(`${ROOMS_URL_TPL}/${propertyCode}`, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WebHotelier API error ${res.status}: ${body}`);
  }

  const data = await res.json();

  // WebHotelier API response: { data: { rooms: [...] } } — handle nesting variants.
  const rooms = data?.data?.rooms || data?.rooms || (Array.isArray(data?.data) ? data.data : []);

  const listings = rooms.map(r => ({
    platform_id: String(r.code || r.id),
    name:        r.name || r.title || `Room ${r.code || r.id}`,
    capacity:    r.capacity?.max_pers ?? r.capacity?.max_persons ?? r.max_persons ?? r.max_capacity ?? null,
    unit_type:   r.unit_type || null,
    platform:    'webhotelier',
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_id: store.id,
      listings,
      platform: 'webhotelier',
      property_code: propertyCode,
    }),
  };
}
