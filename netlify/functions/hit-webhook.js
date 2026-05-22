// hit-webhook.js
// Push receiver for the HIT DataExchange API (Protel-backed properties).
//
// Unlike our other PMS providers (HostHub / WebHotelier / RoomRack / Hotelizer),
// HIT does NOT expose a pull REST API we poll. Instead the PMS POSTs transactions
// to a webhook we expose. This endpoint is that webhook.
//
// STATUS: CAPTURE-ONLY scaffold.
//   It authenticates (optional shared secret), logs the full transaction to
//   webhook_logs, and returns an ACK so HIT marks the transaction delivered.
//   It deliberately does NOT yet parse entities into bookings — that comes once
//   we (a) have the final (non-draft) spec and/or (b) capture real payloads here.
//
// Why capture-first: the spec we have is a Draft (v1.0.2). Logging the real
// transactions HIT sends is far more reliable than guessing field shapes from
// the draft, and lets us build the parser against ground truth.
//
// Expected entities (per draft): Hotel, Room, RoomType, Reservation, Package,
// ReservationAnalysisPackage. Breakfast is NOT a field on Reservation — it must
// be derived by joining Package (master: does this package include breakfast?)
// with ReservationAnalysisPackage (per reservation-per-date).
//
// Auth: once HIT confirms how they authenticate their push, set HIT_WEBHOOK_TOKEN
// on Netlify and we reject mismatches. Until then we accept + log everything
// (incl. the inbound Authorization header) so we can see exactly what they send.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  const start = Date.now();

  if (event.httpMethod === 'OPTIONS') return resp(204, '');
  if (event.httpMethod !== 'POST') {
    return resp(405, JSON.stringify({ error: 'Method not allowed. HIT DataExchange pushes via POST.' }));
  }

  // Optional shared-secret gate. Left open (authed=true) until HIT_WEBHOOK_TOKEN
  // is configured, so we can capture HIT's very first attempts and learn their
  // real auth scheme.
  const expected = process.env.HIT_WEBHOOK_TOKEN;
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const token = event.queryStringParameters?.token || bearer;
  const authed = !expected || token === expected;

  let body = null;
  try { body = JSON.parse(event.body || 'null'); } catch { body = { _raw: event.body }; }

  const ack = {
    received: true,
    status: authed ? 'accepted' : 'unauthenticated',
    note: 'Horizon HIT receiver (capture mode). Entity processing not yet enabled.',
    ts: new Date().toISOString(),
  };

  // Best-effort capture — never let logging break the ACK back to HIT.
  try {
    await supabase.from('webhook_logs').insert({
      endpoint: '/api/hit-webhook',
      http_method: event.httpMethod,
      request_headers: event.headers || null,
      request_body: body,
      response_status: 200,
      response_body: ack,
      duration_ms: Date.now() - start,
      ip: event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'] || null,
    });
  } catch (logErr) {
    console.error('hit-webhook webhook_logs insert failed:', logErr);
  }

  return resp(200, JSON.stringify(ack));
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body,
  };
}
