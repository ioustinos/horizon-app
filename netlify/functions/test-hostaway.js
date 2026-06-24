// netlify/functions/test-hostaway.js
// Diagnostic: hits Hostaway with creds from query params and dumps shapes
// for listings + reservations + amenities + customFields.
//
// Usage:
//   curl 'https://horizon-app-is.netlify.app/api/test-hostaway?a=ACCOUNT&k=KEY&from=2026-06-01&to=2026-09-30&listingId=496314'

export async function handler(event) {
  const a = event.queryStringParameters?.a;
  const k = event.queryStringParameters?.k;
  const from = event.queryStringParameters?.from || new Date().toISOString().slice(0, 10);
  const to   = event.queryStringParameters?.to   || new Date(Date.now() + 30*86400000).toISOString().slice(0, 10);
  const listingId = event.queryStringParameters?.listingId || '';

  if (!a || !k) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing a (account_id) and/or k (api_key) query params' }) };
  }

  const BASE = 'https://api.hostaway.com/v1';
  const out = { credentials_ok: false };

  try {
    // 1. Issue token
    const body = new URLSearchParams({
      grant_type: 'client_credentials', client_id: a, client_secret: k, scope: 'general',
    });
    const tRes = await fetch(`${BASE}/accessTokens`, {
      method: 'POST',
      headers: { 'Content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    out.token = { status: tRes.status };
    if (!tRes.ok) { out.token.body = await tRes.text(); return resp(out); }
    const token = (await tRes.json()).access_token;
    if (!token) { out.token.error = 'no access_token'; return resp(out); }
    out.credentials_ok = true;
    await new Promise(r => setTimeout(r, 1100));
    const HDR = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // 2. listings sample
    const lUrl = `${BASE}/listings?limit=5&includeResources=1`;
    const lRes = await fetch(lUrl, { headers: HDR });
    const lBody = await safeJson(lRes);
    out.listings = { status: lRes.status, total_count: lBody?.count, sample: (lBody?.result || []).slice(0, 3) };

    // 3. amenities catalog (subset of breakfast-related)
    const aRes = await fetch(`${BASE}/amenities`, { headers: HDR });
    const aBody = await safeJson(aRes);
    const all = aBody?.result || [];
    out.amenities = {
      status: aRes.status, total: all.length,
      breakfast_related: all.filter(x => /breakfast|meal|bed.*breakfast|b&b/i.test(String(x?.name || ''))),
    };

    // 4. customFields catalog
    const cfRes = await fetch(`${BASE}/customFields`, { headers: HDR });
    const cfBody = await safeJson(cfRes);
    out.customFields = { status: cfRes.status, all: cfBody?.result };

    // 5. reservations for the given listingId (if any), expanded
    if (listingId) {
      const rUrl = `${BASE}/reservations?limit=5&includeResources=1&arrivalStartDate=${from}&arrivalEndDate=${to}&listingId=${listingId}`;
      const rRes = await fetch(rUrl, { headers: HDR });
      const rBody = await safeJson(rRes);
      out.reservations = {
        status: rRes.status, total_count: rBody?.count, url: rUrl,
        sample: (rBody?.result || []).slice(0, 3).map(r => ({
          id: r.id, listingMapId: r.listingMapId,
          arrivalDate: r.arrivalDate, departureDate: r.departureDate,
          status: r.status, channelName: r.channelName, numberOfGuests: r.numberOfGuests,
          cancellationDate: r.cancellationDate,
          fee_names: (r.reservationFees || []).map(f => f.name),
          custom_field_values: r.customFieldValues || [],
          hostNote: r.hostNote, guestNote: r.guestNote, comment: r.comment,
        })),
      };
    }

    return resp(out);
  } catch (e) {
    out.error = e.message;
    return resp(out);
  }
}

function resp(body) { return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) }; }
async function safeJson(res) { try { return await res.json(); } catch { return null; } }
