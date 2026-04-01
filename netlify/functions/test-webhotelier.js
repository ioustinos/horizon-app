// test-webhotelier.js
// Diagnostic: test WebHotelier API auth and endpoints
// GET /api/test-webhotelier?property=HRZNTEST&username=HRZNTEST&password=XXX
// Also supports: ?action=rooms | ?action=bookings

export const handler = async (event) => {
  const params = event.queryStringParameters || {};
  const property = params.property || 'HRZNTEST';
  const username = params.username || '';
  const password = params.password || '';
  const action   = params.action   || 'all'; // all | property | rooms | rates | bookings

  if (!username || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'username and password query params required' }),
    };
  }

  const baseUrl = 'https://rest.reserve-online.net';
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const headers = {
    Authorization: authHeader,
    Accept: 'application/json',
  };

  const results = {};

  async function tryFetch(label, url) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      results[label] = { status: res.status, ok: res.ok, data };
    } catch (err) {
      results[label] = { error: err.message };
    }
  }

  if (action === 'all' || action === 'property') {
    await tryFetch('property', `${baseUrl}/property/${property}`);
  }

  if (action === 'all' || action === 'rooms') {
    await tryFetch('rooms', `${baseUrl}/room/${property}`);
  }

  if (action === 'all' || action === 'rates') {
    await tryFetch('rates', `${baseUrl}/rate/${property}`);
  }

  if (action === 'all' || action === 'bookings') {
    // Try multiple possible booking search endpoints
    const today = new Date().toISOString().split('T')[0];
    const future = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
    const past = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    await tryFetch('booking_search',
      `${baseUrl}/booking/${property}?arrival_from=${past}&arrival_to=${future}`);
    await tryFetch('booking_search_alt',
      `${baseUrl}/booking/search?property=${property}&from=${past}&to=${future}`);
    await tryFetch('booking_list',
      `${baseUrl}/booking/${property}`);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ property, action, results }, null, 2),
  };
};
