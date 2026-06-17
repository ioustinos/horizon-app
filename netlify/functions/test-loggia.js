// netlify/functions/test-loggia.js
// Diagnostic: hits the Loggia API with credentials from query params and
// dumps shapes of /properties + /bookings so we can verify response field
// names match what providers/loggia.js expects.
//
// Usage:
//   curl 'https://horizon-app-is.netlify.app/api/test-loggia?p=PAGE_ID&k=API_KEY&from=2026-06-01&to=2026-06-30'

export async function handler(event) {
  const p = event.queryStringParameters?.p;
  const k = event.queryStringParameters?.k;
  const from = event.queryStringParameters?.from || new Date().toISOString().slice(0, 10);
  const to   = event.queryStringParameters?.to   || new Date(Date.now() + 30*86400000).toISOString().slice(0, 10);

  if (!p || !k) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing p (page_id) and/or k (api_key) query params' }) };
  }

  const HDR = { 'x-api-key': k, Accept: 'application/json' };
  const BASE = 'https://api.loggia.net';
  const out = { credentials_ok: false, properties: null, bookings: null };

  try {
    const propUrl = `${BASE}/api/builder/properties/manager/list/data/v2?page_id=${encodeURIComponent(p)}`;
    const pRes = await fetch(propUrl, { headers: HDR });
    const pBody = await safeJson(pRes);
    out.properties = { status: pRes.status, url: propUrl, body_keys: keysOf(pBody), sample: sample(pBody) };
    if (!pRes.ok) return resp(out);
    out.credentials_ok = true;

    const params = new URLSearchParams({
      page_id: String(p), main_filter: 'all_properties',
      date_from: from, date_to: to, date_year: from.slice(0,4),
      source_types: 'all',
    });
    const bUrl = `${BASE}/api/lodge/bookings/list?${params.toString()}`;
    const bRes = await fetch(bUrl, { headers: HDR });
    const bBody = await safeJson(bRes);
    out.bookings = { status: bRes.status, url: bUrl, body_keys: keysOf(bBody), sample: sample(bBody) };

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
function keysOf(o) {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) return ['(array)', `length=${o.length}`];
  return Object.keys(o);
}
function sample(o) {
  if (!o) return null;
  if (Array.isArray(o)) return o.slice(0, 2);
  for (const k of ['data', 'properties', 'items', 'bookings', 'results']) {
    if (Array.isArray(o[k])) return o[k].slice(0, 2);
  }
  return o;
}
