// test-roomrack.js
// Diagnostic — fetch raw RoomRack responses to inspect listings + booking
// shapes before relying on the provider in production.
//
// Two ways to call it:
//   GET /api/test-roomrack?store_id=<uuid>      ← preferred; pulls ApiToken
//                                                 from the linked store
//   GET /api/test-roomrack?api_token=<token>    ← provide a token directly
//
// Optional:
//   ?action=all|rooms|room_types|reservations|channels   (default: all)
//   ?room_number=<n>                                     (filter reservations
//                                                         to a specific room)
//
// RoomRack has no public demo environment. To get a token, the property
// must enable the Partners API in their RoomRack PMS at
// Setup → Device Interface → Partners API, which produces a UUID token.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BASE_URL = 'https://pms.abouthotelier.com/api/RoomRackAPI';

export const handler = async (event) => {
  const params = event.queryStringParameters || {};
  const action = params.action || 'all';
  const storeId = params.store_id;

  // ── Resolve credentials ──────────────────────────────────────────────────
  let apiToken, sourceLabel;

  if (storeId) {
    const { data: store, error } = await supabase
      .from('stores')
      .select('id, name, platform, api_key_secret')
      .eq('id', storeId)
      .single();
    if (error || !store) {
      return respond(404, { error: `Store not found for id ${storeId}` });
    }
    if (store.platform !== 'roomrack') {
      return respond(400, { error: `Store ${store.name} is platform "${store.platform}", not roomrack.` });
    }
    if (!store.api_key_secret) {
      return respond(422, { error: `Store ${store.name} has no api_key_secret (ApiToken) set.` });
    }
    apiToken = store.api_key_secret;
    sourceLabel = `from store "${store.name}" (${storeId})`;
  } else {
    apiToken = params.api_token;
    sourceLabel = 'from query params';
    if (!apiToken) {
      return respond(400, { error: 'Provide either ?store_id=<uuid> or ?api_token=<token>.' });
    }
  }

  const results = {};

  async function tryFetch(label, path, extra = {}) {
    const qs = new URLSearchParams({ ApiToken: apiToken, ...extra });
    const url = `${BASE_URL}/${path}?${qs.toString()}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      results[label] = {
        url: url.replace(apiToken, '<TOKEN>'),
        status: res.status,
        ok: res.ok,
        data,
      };
    } catch (err) {
      results[label] = { url: url.replace(apiToken, '<TOKEN>'), error: err.message };
    }
  }

  if (action === 'all' || action === 'rooms') {
    await tryFetch('rooms', 'GetAllRooms');
  }
  if (action === 'all' || action === 'room_types') {
    await tryFetch('room_types', 'GetRoomTypes');
  }
  if (action === 'all' || action === 'channels') {
    await tryFetch('channels', 'GetBookingChannels');
  }
  if (action === 'all' || action === 'reservations') {
    // RoomRack expects dates as dd-MM-yyyy (different from the response format).
    const today  = new Date();
    const past   = new Date(today.getTime() - 30 * 86400000);
    const future = new Date(today.getTime() + 90 * 86400000);
    const fmt = d => `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;

    const extras = { From: fmt(past), To: fmt(future), DateCheckType: '0', TCO: '1' };
    if (params.room_number) extras.RoomNumber = params.room_number;

    await tryFetch('reservations', 'GetReservations', extras);
  }

  // ── Focused summary so you don't have to scan the full payload ───────────
  const summary = {
    rooms: extractRoomsSummary(results.rooms),
    reservations: extractReservationsSummary(results.reservations),
  };

  return respond(200, {
    creds_source: sourceLabel,
    action,
    summary,
    results,
  });
};

// ── Summary helpers ──────────────────────────────────────────────────────

function extractRoomsSummary(roomsResp) {
  if (!roomsResp || !roomsResp.ok) return { error: 'rooms call failed or skipped' };
  const data = roomsResp.data;
  const list = Array.isArray(data) ? data : (data?.rooms || data?.data?.rooms || data?.data || []);
  return {
    count: Array.isArray(list) ? list.length : 0,
    sample_keys_first_row: list?.[0] ? Object.keys(list[0]).sort() : null,
    rows: (list || []).slice(0, 10).map(r => ({
      room_number: r.room_number ?? r.RoomNumber ?? null,
      room_id: r.room_id ?? r.RoomId ?? null,
      category_name: r.room_category_name ?? r.category_name ?? null,
      max_persons: r.max_persons ?? r.MaxPersons ?? r.capacity ?? null,
      raw_keys: Object.keys(r),
    })),
  };
}

function extractReservationsSummary(resResp) {
  if (!resResp || !resResp.ok) return { error: 'reservations call failed or skipped' };
  const data = resResp.data;
  const list = Array.isArray(data) ? data : (data?.reservations || data?.data?.reservations || data?.data || []);
  if (!Array.isArray(list) || !list.length) {
    return { count: 0, note: 'No reservations returned in the queried window.' };
  }
  return {
    count: list.length,
    sample_keys_first_row: Object.keys(list[0]).sort(),
    sample_first_3: list.slice(0, 3).map(b => ({
      resid: b.resid ?? b.ResId ?? null,
      ota_booking_ref: b.ota_booking_ref ?? null,
      room_number: b.room_number ?? null,
      res_status: b.res_status ?? null,
      board: b.board ?? null,
      checkin: b.checkin ?? null,
      checkout: b.checkout ?? null,
      adults: b.adults ?? null,
      children: b.children ?? null,
      raw_keys: Object.keys(b),
    })),
  };
}

// ── Plumbing ─────────────────────────────────────────────────────────────

function respond(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  };
}
