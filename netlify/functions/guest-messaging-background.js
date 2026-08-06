// guest-messaging-background.js
// Hourly scheduled entry point (see netlify.toml) for the WhatsApp/SMS guest
// messaging sweep. All real logic lives in messaging/engine.js; this wrapper
// exists so Netlify's scheduler has a function to call.
//
// Safe by default: with no Twilio env vars the sweep runs in dry-run mode
// (audience logged to guest_messages, nothing sent), and stores are only
// processed when stores.messaging_enabled is true (default false).

import { runSweep } from './messaging/engine.js';

export const handler = async () => {
  try {
    const summary = await runSweep();
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('guest-messaging sweep failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
