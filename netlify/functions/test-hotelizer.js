// test-hotelizer.js
// Diagnostic — hits the Hotelizer Integrations API against the public demo
// environment so we can read the actual response shapes before wiring up a
// full provider.
//
// GET /api/test-hotelizer
//   ?username=username           (optional — defaults to demo)
//   &password=pass               (optional — defaults to demo)
//   &checkin_from=2024-01-01     (optional — defaults to ~30 days ago)
//   &checkin_to=2025-12-31       (optional — defaults to ~90 days ahead)
//
// The demo Basic Auth creds (`username` / `pass`) come straight from
// https://hotelizer.gitbook.io/hotelizer-api/guidelines  →  "Basic Auth: Demo environment".

const BASE_URL = 'https://app.hotelizer.net/api/integrations';

export const handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const username = qs.username || 'username';
  const password = qs.password || 'pass';

  const today = new Date();
  const back  = new Date(today); back.setDate(today.getDate() - 30);
  const fwd   = new Date(today); fwd.setDate(today.getDate() + 90);
  const iso = d => d.toISOString().slice(0, 10);

  const checkin_from = qs.checkin_from || iso(back);
  const checkin_to   = qs.checkin_to   || iso(fwd);

  const basic = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const headers = { Authorization: basic, Accept: 'application/json' };

  // What we want to inspect.
  const targets = [
    { label: 'rooms',          url: `${BASE_URL}/rooms?limit=10` },
    { label: 'room_types',     url: `${BASE_URL}/room_types?limit=10` },
    { label: 'accommodations', url: `${BASE_URL}/accommodations?checkin_from=${checkin_from}&checkin_to=${checkin_to}&limit=3` },
  ];

  const results = {};
  for (const t of targets) {
    try {
      const res = await fetch(t.url, { headers });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.length > 600 ? text.slice(0, 600) + '…' : text;
      }
      results[t.label] = { status: res.status, url: t.url, body };
    } catch (err) {
      results[t.label] = { error: err.message, url: t.url };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth: `Basic ${username}:${'*'.repeat(password.length)}`,
      window: { checkin_from, checkin_to },
      results,
    }, null, 2),
  };
};
