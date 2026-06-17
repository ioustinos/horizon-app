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

    // Surface ALL distinct rate_names + meal-plan-ish text across the whole
    // reservations array so we can see whether breakfast is captured anywhere
    // in Loggia's response shape (rate_name / notes / fees / etc).
    const allBookings = Array.isArray(bBody?.reservations) ? bBody.reservations : [];
    const rateNames = {};
    const textFields = {};
    const otherKeys = new Set();
    for (const b of allBookings) {
      const rn = b.rate_name ?? '(none)';
      rateNames[rn] = (rateNames[rn] || 0) + 1;
      // Any field that looks like it could carry meal-plan / breakfast info
      for (const k of Object.keys(b)) {
        const lk = k.toLowerCase();
        if (lk.includes('meal') || lk.includes('breakfast') || lk.includes('board')
            || lk.includes('rate') || lk.includes('plan') || lk.includes('extra')
            || lk.includes('fee') || lk.includes('addon') || lk.includes('add_on')) {
          otherKeys.add(k);
        }
      }
    }
    out.rate_names_distribution = rateNames;
    out.candidate_breakfast_fields = Array.from(otherKeys).sort();
    out.bookings_total = allBookings.length;

    // Pick a property_id from the response (or accept ?property_id= override)
    // to probe the rates + addons + property-summary endpoints — these are
    // the *definitional* endpoints in the Postman collection; they may
    // expose meal-plan info that's missing from the bookings response.
    const probeProp = event.queryStringParameters?.property_id
      || (Array.isArray(out.bookings?.sample) && out.bookings.sample[0]?.property_id)
      || null;
    if (probeProp) {
      const ratesUrl = `${BASE}/api/lodge/properties/get-active-rates?property_id=${probeProp}&page_id=${encodeURIComponent(p)}`;
      const rRes = await fetch(ratesUrl, { headers: HDR });
      const rBody = await safeJson(rRes);
      out.active_rates = { status: rRes.status, url: ratesUrl, body_keys: keysOf(rBody), sample: sample(rBody) };

      const addonsUrl = `${BASE}/api/lodge/properties/addons?locale=en&page_id=${encodeURIComponent(p)}&property_id=${probeProp}&addon_type=all`;
      const aRes = await fetch(addonsUrl, { headers: HDR });
      const aBody = await safeJson(aRes);
      out.addons = { status: aRes.status, url: addonsUrl, body_keys: keysOf(aBody), sample: sample(aBody) };

      const summaryUrl = `${BASE}/api/lodge/properties/summary?property_id=${probeProp}&locale=en&page_id=${encodeURIComponent(p)}`;
      const sRes = await fetch(summaryUrl, { headers: HDR });
      const sBody = await safeJson(sRes);
      out.summary = { status: sRes.status, url: summaryUrl, body_keys: keysOf(sBody), sample: sample(sBody) };

      const policiesUrl = `${BASE}/api/lodge/properties/policies-data?property_id=${probeProp}&locale=en&viewType=vrbo`;
      const polRes = await fetch(policiesUrl, { headers: HDR });
      const polBody = await safeJson(polRes);
      out.policies = { status: polRes.status, url: policiesUrl, body_keys: keysOf(polBody), sample: sample(polBody) };

      out.probed_property_id = probeProp;
    }

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
