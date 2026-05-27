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

  // ── Shared-secret gate ─────────────────────────────────────────────────────
  // Left open (authed=true) until HIT_WEBHOOK_TOKEN is configured. Once set,
  // mismatches are rejected with status 'unauthenticated'.
  const expected = process.env.HIT_WEBHOOK_TOKEN;
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const token = event.queryStringParameters?.token || bearer;
  const tokenOk = !expected || token === expected;

  // ── IP allowlist gate ──────────────────────────────────────────────────────
  // Defense in depth on top of the token. HIT_WEBHOOK_IP_ALLOWLIST is a
  // comma-separated list of exact IPs or CIDR ranges (IPv4). Empty / unset =
  // allow all (current behavior). Once HIT confirms their egress IPs, set the
  // env var and the receiver locks down to those sources.
  const clientIp = extractClientIp(event);
  const allowlistRaw = process.env.HIT_WEBHOOK_IP_ALLOWLIST || '';
  const allowlist = allowlistRaw.split(',').map(s => s.trim()).filter(Boolean);
  const ipOk = allowlist.length === 0 || allowlist.some(entry => ipMatches(clientIp, entry));

  // Final auth decision combines both gates.
  const authed = tokenOk && ipOk;
  const failureReason = !tokenOk ? 'unauthenticated' : (!ipOk ? 'ip_blocked' : null);

  let body = null;
  try { body = JSON.parse(event.body || 'null'); } catch { body = { _raw: event.body }; }

  const ack = {
    received: true,
    status: authed ? 'accepted' : (failureReason || 'unauthenticated'),
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


// ─── IP helpers (IPv4) ──────────────────────────────────────────────────────
// Netlify forwards the originating IP via x-forwarded-for / client-ip.
// We take the FIRST entry of x-forwarded-for (the original client), trim
// whitespace, strip any ::ffff: IPv6-mapped-IPv4 prefix.
function extractClientIp(event) {
  const xff = event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || '';
  const ip = String(xff).split(',')[0]?.trim() || event.headers?.['client-ip'] || event.headers?.['Client-IP'] || '';
  return ip.replace(/^::ffff:/, '');
}

// Match an IP against either an exact IP or a CIDR range.
// Returns true if the IP is in the entry. Invalid entries return false rather
// than throw — better to log + skip than blow up the receiver.
function ipMatches(ip, entry) {
  if (!ip || !entry) return false;
  if (!entry.includes('/')) return ip === entry;
  const [base, bitsStr] = entry.split('/');
  const bits = parseInt(bitsStr, 10);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    n = (n * 256) + v;
  }
  return n >>> 0;
}

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
