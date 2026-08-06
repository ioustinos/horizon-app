// force-messaging.js
// Manual trigger for the guest-messaging sweep — for testing without waiting
// for the hourly schedule. Guarded by a shared secret so nobody can trigger
// real sends from outside:
//
//   POST /.netlify/functions/force-messaging
//   Header: x-messaging-key: <MESSAGING_FORCE_KEY env var>
//   Body (optional JSON): { "hour": 18, "storeId": "<uuid>" }
//     hour    — pretend the Athens hour is this value (default: actual hour)
//     storeId — limit the sweep to one store
//
// Returns 403 when MESSAGING_FORCE_KEY is unset (endpoint disabled) or the
// key doesn't match. While Twilio is unconfigured this is harmless either
// way — the sweep only writes dry_run rows.

import { runSweep } from './messaging/engine.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const key = process.env.MESSAGING_FORCE_KEY;
  const provided = event.headers?.['x-messaging-key'];
  if (!key || provided !== key) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let opts = {};
  try {
    const body = JSON.parse(event.body || '{}');
    if (Number.isInteger(body.hour)) opts.hourOverride = body.hour;
    if (body.storeId) opts.storeIdFilter = body.storeId;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  try {
    const summary = await runSweep(opts);
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('force-messaging failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
