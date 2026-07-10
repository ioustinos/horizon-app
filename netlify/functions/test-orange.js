// test-orange.js
// Diagnostic: poke the Orange Cloud PMS (Coral) API directly.
//   GET /api/test-orange?username=wecook&password=…            (auto-discover hotel)
//   GET /api/test-orange?username=wecook&password=…&hotel=777
//   GET /api/test-orange?store_id=<uuid>                        (creds from DB)
// Returns hotels, rooms and a reservation-window sample with meal-plan and
// status distributions.

import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://hotel.orangepms.com/orange';

export const handler = async (event) => {
  const q = event.queryStringParameters || {};
  let username = q.username;
  let password = q.password;
  let hotel = q.hotel;

  try {
    if (q.store_id) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data: store, error } = await supabase
        .from('stores').select('api_key_name, api_key_secret').eq('id', q.store_id).single();
      if (error || !store) throw new Error('Store not found');
      const raw = String(store.api_key_name || '');
      const idx = raw.lastIndexOf(':');
      if (idx > 0 && /^\d+$/.test(raw.slice(idx + 1))) { username = raw.slice(0, idx); hotel = hotel || raw.slice(idx + 1); }
      else username = raw;
      password = store.api_key_secret;
    }
    if (!username || !password) throw new Error('username + password (or store_id) required');

    const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const get = async (path) => {
      const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* keep raw */ }
      return { status: res.status, json, raw: json ? undefined : text.slice(0, 500) };
    };

    const hotels = await get('/hotels');
    if (!hotel && Array.isArray(hotels.json) && hotels.json.length === 1) hotel = String(hotels.json[0].HotelID);

    const out = { hotels };
    if (hotel) {
      const rooms = await get(`/hotels/${hotel}/rooms`);
      const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
      const res  = await get(`/reservations?hotel=${hotel}&departure_from=${from}&arrival_to=${to}&simple=0`);
      const list = Array.isArray(res.json) ? res.json : [];
      const dist = (key) => list.reduce((m, b) => ((m[b[key] ?? 'null'] = (m[b[key] ?? 'null'] || 0) + 1), m), {});
      out.rooms = { status: rooms.status, count: Array.isArray(rooms.json) ? rooms.json.length : null, sample: (rooms.json || [])[0] };
      out.reservations = {
        status: res.status, window: { from, to }, count: list.length,
        meal_plan_distribution: dist('MealPlan'), status_distribution: dist('Status'),
        sample: list[0] || null,
      };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
