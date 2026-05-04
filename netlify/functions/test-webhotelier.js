// test-webhotelier.js
// Diagnostic — fetch raw WebHotelier responses to inspect what the API
// actually returns: are listings types or units, and do bookings carry a
// per-unit reference we could use for granular validation?
//
// Two ways to call it:
//   GET /api/test-webhotelier?store_id=<uuid>      ← preferred; pulls creds
//                                                    from the stores table
//   GET /api/test-webhotelier?property=HRZNTEST&username=...&password=...
//
// Optional: ?action=all|property|rooms|rates|bookings (default: all)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  const params  = event.queryStringParameters || {};
  const action  = params.action || 'all';
  const storeId = params.store_id;

  // ── Resolve credentials ──────────────────────────────────────────────────
  let property, username, password, sourceLabel;

  if (storeId) {
    const { data: store, error } = await supabase
      .from('stores')
      .select('id, name, platform, api_key_name, api_key_secret')
      .eq('id', storeId)
      .single();
    if (error || !store) {
      return respond(404, { error: `Store not found for id ${storeId}` });
    }
    if (store.platform !== 'webhotelier') {
      return respond(400, { error: `Store ${store.name} is platform "${store.platform}", not webhotelier.` });
    }
    if (!store.api_key_name || !store.api_key_secret) {
      return respond(422, { error: `Store ${store.name} is missing api_key_name (property/username) or api_key_secret (password).` });
    }
    property = store.api_key_name;
    username = store.api_key_name;   // WebHotelier convention: api_key_name = property = username
    password = store.api_key_secret;
    sourceLabel = `from store "${store.name}" (${storeId})`;
  } else {
    property = params.property || params.username;
    username = params.username || params.property;
    password = params.password;
    sourceLabel = 'from query params';
    if (!username || !password) {
      return respond(400, { error: 'Provide either ?store_id=<uuid> or ?property=&username=&password=.' });
    }
  }

  const baseUrl = 'https://rest.reserve-online.net';
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    Accept: 'application/json',
  };

  const results = {};

  async function tryFetch(label, url) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      results[label] = { url, status: res.status, ok: res.ok, data };
    } catch (err) {
      results[label] = { url, error: err.message };
    }
  }

  if (action === 'all' || action === 'property') {
    await tryFetch('property', `${baseUrl}/property/${property}`);
  }
  if (action === 'all' || action === 'rooms') {
    await tryFetch('rooms', `${baseUrl}/room/${property}`);
  }
  if (action === 'all' || action === 'rates') {
    await tryFetch('rates', `${baseUrl}/rate/${property}?verbose=2`);
  }
  if (action === 'all' || action === 'bookings') {
    const today  = new Date().toISOString().slice(0, 10);
    const past   = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    await tryFetch('booking_search_full',
      `${baseUrl}/reservation?chkin_fromd=${past}&chkin_tod=${future}&verbose=2&maxrows=100`);
    await tryFetch('booking_search_all',
      `${baseUrl}/reservation?verbose=2&maxrows=100`);
  }

  // ── Build a focused summary so you don't have to scan the full payload ──
  const summary = {
    question: 'Are listings types or units? Do bookings carry per-unit refs?',
    listings: extractListingsSummary(results.rooms),
    bookings: extractBookingsSummary(results.booking_search_full || results.booking_search_all),
  };

  return respond(200, {
    creds_source: sourceLabel,
    property,
    action,
    summary,
    results,
  });
};

// ── Summary helpers ──────────────────────────────────────────────────────

// Pull every key on each listing — that's what tells us whether we have
// units vs types: a `unit_type`, `units`, or `room_id` field is the smoking
// gun.
function extractListingsSummary(roomsResp) {
  if (!roomsResp || !roomsResp.ok) return { error: 'rooms call failed or skipped' };
  const data = roomsResp.data;
  const list = data?.data?.rooms || data?.rooms || (Array.isArray(data?.data) ? data.data : []);
  return {
    count: list.length,
    sample_keys_first_row: list[0] ? Object.keys(list[0]).sort() : null,
    rows: list.map(r => ({
      code: r.code ?? r.id ?? null,
      id: r.id ?? null,
      name: r.name ?? r.title ?? null,
      unit_type: r.unit_type ?? null,
      units: r.units ?? null,                       // would tell us this is a TYPE with N physical units
      max_persons: r.capacity?.max_pers ?? r.max_persons ?? null,
      raw_keys: Object.keys(r),                     // every field we got, so we can spot the unit field
    })),
  };
}

// Pull every key on each booking — and especially the rooms[] array — to
// see if there's a per-unit reference (room number, unit id, etc.).
function extractBookingsSummary(bookingsResp) {
  if (!bookingsResp || !bookingsResp.ok) return { error: 'bookings call failed or skipped' };
  const data = bookingsResp.data;
  const list = data?.data?.reservations || data?.data?.bookings ||
               (Array.isArray(data?.data) ? data.data : []);
  if (!list.length) return { count: 0, note: 'No bookings returned in the queried window.' };

  const sample = list.slice(0, 3).map(b => {
    const stay = b.roomStay || {};
    const rooms = b.rooms || [];
    return {
      id: b.id,
      status: b.statusCode || b.status,
      check_in:  stay.from,
      check_out: stay.to,
      roomStay_keys: Object.keys(stay).sort(),
      // The juicy bit — every key on the rooms[] entries
      rooms_array_count: rooms.length,
      rooms_array_first_keys: rooms[0] ? Object.keys(rooms[0]).sort() : null,
      rooms_array_sample: rooms.map(r => ({
        roomType: r.roomType ?? r.room_type ?? r.code ?? null,
        roomId:   r.roomId   ?? r.room_id   ?? r.unitId ?? r.unit_id ?? r.unit ?? null,
        roomName: r.roomName ?? r.name ?? null,
        adults:   r.adults,
        children: r.children,
        raw_keys: Object.keys(r),
      })),
      top_level_keys: Object.keys(b).sort(),
    };
  });

  return {
    count: list.length,
    sample_first_3: sample,
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
