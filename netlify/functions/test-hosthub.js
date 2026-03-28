// test-hosthub.js
// Temporary diagnostic function — fetches raw HostHub data to verify auth + endpoint shape.
// GET /api/test-hosthub?api_key=YOUR_KEY&env=staging

export const handler = async (event) => {
  const apiKey = event.queryStringParameters?.api_key;
  const env    = event.queryStringParameters?.env || 'staging';

  if (!apiKey) {
    return respond(400, { error: 'Missing api_key query param' });
  }

  const baseUrl = env === 'production'
    ? 'https://app.hosthub.com/api/2019-03-01'
    : 'https://eric.hosthub.com/api/2019-03-01';

  // HostHub uses ApiKeyAuth — try the most likely header formats
  const authFormats = [
    { label: 'apiKey prefix',  header: `apiKey ${apiKey}` },
    { label: 'Bearer prefix',  header: `Bearer ${apiKey}` },
    { label: 'plain token',    header: apiKey },
  ];

  const results = {};

  for (const auth of authFormats) {
    const headers = { Authorization: auth.header, 'Content-Type': 'application/json' };

    // Test /rentals first (we know this endpoint exists — returns 401 not 404)
    const rentalsRes = await fetch(`${baseUrl}/rentals`, { headers });
    const rentalsStatus = rentalsRes.status;
    let rentalsBody = null;
    if (rentalsStatus === 200) {
      rentalsBody = await rentalsRes.json();
    }

    results[auth.label] = { status: rentalsStatus };

    // If auth worked, fetch calendar_events (bookings)
    if (rentalsStatus === 200) {
      results[auth.label].rentals = rentalsBody;

      const eventsRes = await fetch(
        `${baseUrl}/calendar_events?per_page=50`,
        { headers }
      );
      const eventsStatus = eventsRes.status;
      results[auth.label].calendar_events_status = eventsStatus;

      if (eventsStatus === 200) {
        results[auth.label].calendar_events = await eventsRes.json();
      } else {
        results[auth.label].calendar_events_error = await eventsRes.text();
      }

      // Also try fetching rentals list for room mapping
      break; // found working auth — no need to try others
    }
  }

  return respond(200, { baseUrl, results });
};

const respond = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data, null, 2),
});
