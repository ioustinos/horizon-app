// test-hosthub.js
// Diagnostic — fires many auth header / endpoint / env combinations against HostHub
// and reports status + a snippet of the response body so we can read the actual error.
//
// GET /api/test-hosthub?api_key=YOUR_KEY[&env=staging|production]

export const handler = async (event) => {
  const apiKey = event.queryStringParameters?.api_key;
  const env    = event.queryStringParameters?.env || 'staging';

  if (!apiKey) {
    return respond(400, { error: 'Missing api_key query param' });
  }

  const baseUrl = env === 'production'
    ? 'https://app.hosthub.com/api/2019-03-01'
    : 'https://eric.hosthub.com/api/2019-03-01';

  // Auth variations — header name + value template combinations.
  const authFormats = [
    { label: 'Authorization: <raw>',          headers: { Authorization: apiKey } },
    { label: 'Authorization: apiKey <raw>',   headers: { Authorization: `apiKey ${apiKey}` } },
    { label: 'Authorization: Bearer <raw>',   headers: { Authorization: `Bearer ${apiKey}` } },
    { label: 'X-API-Key: <raw>',              headers: { 'X-API-Key': apiKey } },
    { label: 'X-Api-Key: <raw>',              headers: { 'X-Api-Key': apiKey } },
    { label: 'Api-Key: <raw>',                headers: { 'Api-Key': apiKey } },
    { label: 'apikey: <raw>',                 headers: { apikey: apiKey } },
  ];

  const results = {};

  for (const auth of authFormats) {
    const headers = { ...auth.headers, 'Content-Type': 'application/json' };

    const res = await fetch(`${baseUrl}/rentals`, { headers });
    const status = res.status;
    let snippet = null;

    try {
      const text = await res.text();
      // Keep response bodies short — we only need the error message
      snippet = text.length > 400 ? text.slice(0, 400) + '…' : text;
    } catch {
      snippet = '<no body>';
    }

    results[auth.label] = { status, body: snippet };

    if (status === 200) break; // found a working format
  }

  return respond(200, { baseUrl, key_used: apiKey, key_length: apiKey.length, results });
};

const respond = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data, null, 2),
});
