// netlify/functions/test-orange.js
// Diagnostic: hits the Orange (CORAL) API with credentials from query params
// and dumps the shapes of /orange/hotels + /orange/hotels/{id}/rooms +
// /orange/reservations so we can verify the live response matches what the
// providers/orange.js parser expects.
//
// Usage:
//   curl 'https://horizon-app-is.netlify.app/api/test-orange?u=USERNAME&p=PASSWORD&from=2026-06-01&to=2026-06-30'
//
// SCAFFOLD — same gating as providers/orange.js. Not exposed in UI; not
// in netlify.toml routes by default; lives here so we can hit it manually
// once we have demo creds.

export async function handler(event) {
  const u = event.queryStringParameters?.u;
  const p = event.queryStringParameters?.p;
  const from = event.queryStringParameters?.from || new Date().toISOString().slice(0, 10);
  const to   = event.queryStringParameters?.to   || new Date(Date.now() + 30*86400000).toISOString().slice(0, 10);

  if (!u || !p) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing u (username) and/or p (password) query params' }) };
  }

  const auth = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
  const BASE = 'https://hotel.orangepms.com/orange';
  const out = { credentials_ok: false, hotels: null, rooms: null, reservations: null };

  try {
    // 1. List hotels
    const hRes = await fetch(`${BASE}/hotels`, { headers: { Authorization: auth, Accept: 'application/json' } });
    out.hotels = { status: hRes.status, body: await safeJson(hRes) };
    if (!hRes.ok) return resp(out);
    out.credentials_ok = true;

    const hotels = Array.isArray(out.hotels.body) ? out.hotels.body : [];
    if (!hotels.length) return resp(out);
    const hotelId = hotels[0].HotelID ?? hotels[0].Hotel_ID ?? hotels[0].id;

    // 2. Rooms for first hotel
    const rRes = await fetch(`${BASE}/hotels/${hotelId}/rooms`, { headers: { Authorization: auth, Accept: 'application/json' } });
    out.rooms = { status: rRes.status, hotel_id: hotelId, body_sample: (await safeJson(rRes))?.slice?.(0, 5) ?? null };

    // 3. Reservations for first hotel + date range
    const qs = new URLSearchParams({ hotel: String(hotelId), arrival_from: from, arrival_to: to, status: '12356' });
    const resRes = await fetch(`${BASE}/reservations?${qs.toString()}`, { headers: { Authorization: auth, Accept: 'application/json' } });
    const resBody = await safeJson(resRes);
    out.reservations = {
      status: resRes.status,
      hotel_id: hotelId,
      window: `${from}..${to}`,
      count: Array.isArray(resBody) ? resBody.length : null,
      first_three: Array.isArray(resBody) ? resBody.slice(0, 3) : resBody,
    };

    return resp(out);
  } catch (e) {
    out.error = e.message;
    return resp(out);
  }
}

function resp(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}

async function safeJson(res) {
  try { return await res.json(); } catch { return await res.text(); }
}
