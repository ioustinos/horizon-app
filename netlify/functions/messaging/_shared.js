// messaging/_shared.js
// Shared infrastructure for the WhatsApp/SMS guest-messaging feature (Twilio).
// Lives in a subdirectory so Netlify does NOT expose it as a function
// (same trick as providers/_shared.js).
//
// Everything here is env-var driven and degrades gracefully:
//   - No Twilio creds  → twilioConfigured() is false → the send job runs in
//     DRY-RUN mode (audience is selected and logged to guest_messages with
//     status 'dry_run', nothing is actually sent).
//   - Creds present    → real sends via Twilio's REST API (plain fetch, no SDK).
//
// Env vars (all optional until go-live):
//   TWILIO_ACCOUNT_SID      ACxxxx — always required for real sends
//   TWILIO_AUTH_TOKEN       master token (used for API auth AND webhook
//                           signature validation)
//   TWILIO_API_KEY_SID      optional API key pair — if set, used for API auth
//   TWILIO_API_KEY_SECRET   instead of the master token (better practice)
//   TWILIO_WHATSAPP_FROM    e.g. whatsapp:+14155238886 (sandbox) or the real sender
//   TWILIO_SMS_FROM         e.g. +1xxxxxxxxxx or alphanumeric 'Horizon' — SMS fallback
//   TPL_BREAKFAST_REMINDER      Content SID HX… (Greek)
//   TPL_BREAKFAST_REMINDER_EN   Content SID HX… (English)
//   TPL_REVIEW_REQUEST          Content SID HX… (Greek)
//   TPL_REVIEW_REQUEST_EN       Content SID HX… (English)
//   SITE_URL                override for webhook base URL (defaults to
//                           process.env.URL, which Netlify sets automatically)

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Config ─────────────────────────────────────────────────────────────────

export function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    (process.env.TWILIO_AUTH_TOKEN || (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET)) &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

export function siteBaseUrl() {
  // Netlify injects URL at runtime; SITE_URL is a manual override.
  return (process.env.SITE_URL || process.env.URL || 'https://horizon-app-is.netlify.app').replace(/\/$/, '');
}

export const STATUS_CALLBACK_URL = () => `${siteBaseUrl()}/.netlify/functions/whatsapp-status`;

// Content SID per template+language, falling back to the Greek one if the
// English twin isn't configured (better a Greek message than none).
export function contentSidFor(template, language) {
  const map = {
    breakfast_reminder: {
      el: process.env.TPL_BREAKFAST_REMINDER,
      en: process.env.TPL_BREAKFAST_REMINDER_EN || process.env.TPL_BREAKFAST_REMINDER,
    },
    review_request: {
      el: process.env.TPL_REVIEW_REQUEST,
      en: process.env.TPL_REVIEW_REQUEST_EN || process.env.TPL_REVIEW_REQUEST,
    },
  };
  return map[template]?.[language] || null;
}

// ─── Phone helpers ──────────────────────────────────────────────────────────

// Normalize a raw phone string to E.164 (+3069xxxxxxxx). Returns null when it
// can't be made valid. GonnaOrder phones are '+'-prefixed but may contain
// spaces ('+30 691 234 5678').
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.trim().replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (!p.startsWith('+')) return null; // no country context — don't guess
  return /^\+[1-9]\d{6,14}$/.test(p) ? p : null;
}

// Greek number → Greek template; everything else → English.
export function pickLanguage(phone) {
  return phone?.startsWith('+30') ? 'el' : 'en';
}

export function firstNameOf(fullName) {
  const first = (fullName || '').trim().split(/\s+/)[0];
  return first || 'there';
}

// ─── Athens time helpers ────────────────────────────────────────────────────
// All scheduling is expressed in Europe/Athens local time; the cron itself
// fires hourly in UTC and we translate here (DST-safe via Intl).

export function athensNow(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;         // YYYY-MM-DD
  const hour = Number(parts.hour) % 24;                              // 0-23
  // Exact UTC instant of Athens midnight today: now minus seconds-since-midnight.
  const secsSinceMidnight = hour * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const startOfDayUtc = new Date(now.getTime() - secsSinceMidnight * 1000);
  return { date, hour, startOfDayUtc };
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`); // noon avoids DST edges
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Twilio REST (no SDK — one fetch) ───────────────────────────────────────

function twilioAuthHeader() {
  const user = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID;
  const pass = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

// Low-level send. params: { To, From, Body?, ContentSid?, ContentVariables?, StatusCallback? }
// Returns { sid, status } or throws with Twilio's error message.
export async function twilioSend(params) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.append(k, String(v));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Twilio ${res.status}: ${json.message || JSON.stringify(json)} (code ${json.code ?? '?'})`);
  }
  return { sid: json.sid, status: json.status };
}

// Business-initiated template message over WhatsApp.
export async function sendWhatsAppTemplate({ to, contentSid, variables }) {
  return twilioSend({
    From: process.env.TWILIO_WHATSAPP_FROM,
    To: `whatsapp:${to}`,
    ContentSid: contentSid,
    ContentVariables: variables ? JSON.stringify(variables) : undefined,
    StatusCallback: STATUS_CALLBACK_URL(),
  });
}

// Free-form message inside an open 24h session window (guest replied recently).
export async function sendWhatsAppSession({ to, body }) {
  return twilioSend({
    From: process.env.TWILIO_WHATSAPP_FROM,
    To: `whatsapp:${to}`,
    Body: body,
    StatusCallback: STATUS_CALLBACK_URL(),
  });
}

// Plain SMS (fallback when WhatsApp delivery fails).
export async function sendSms({ to, body }) {
  if (!process.env.TWILIO_SMS_FROM) throw new Error('TWILIO_SMS_FROM not configured');
  return twilioSend({
    From: process.env.TWILIO_SMS_FROM,
    To: to,
    Body: body,
    StatusCallback: STATUS_CALLBACK_URL(),
  });
}

// ─── Webhook signature validation ───────────────────────────────────────────
// Twilio signs webhooks: X-Twilio-Signature = Base64(HMAC-SHA1(authToken,
// fullUrl + concat(sortedParamKey + value))). We validate against the exact
// URL we configure in the Twilio console (the direct /.netlify/functions/...
// path — do NOT point Twilio at an /api/* redirect, the rewrite would change
// the signed URL).
// Returns true when valid OR when TWILIO_AUTH_TOKEN is unset (pre-go-live:
// nothing secret exists yet, and we still want to test the plumbing).
export function validateTwilioSignature(event, functionName) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    console.warn(`[${functionName}] TWILIO_AUTH_TOKEN not set — skipping signature validation`);
    return true;
  }
  const signature = event.headers?.['x-twilio-signature'] || event.headers?.['X-Twilio-Signature'];
  if (!signature) return false;

  const url = `${siteBaseUrl()}/.netlify/functions/${functionName}`;
  const params = new URLSearchParams(event.body || '');
  const sorted = [...params.keys()].sort();
  let data = url;
  for (const k of sorted) data += k + params.get(k);

  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── guest_messages logging ─────────────────────────────────────────────────

export async function logGuestMessage(row) {
  const { data, error } = await supabase
    .from('guest_messages')
    .insert({ ...row, updated_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) console.error('guest_messages insert failed:', error, row);
  return data?.id ?? null;
}

export async function isOptedOut(phone) {
  const { data } = await supabase
    .from('message_optouts')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();
  return Boolean(data);
}

export async function optOut(phone, reason) {
  await supabase.from('message_optouts').upsert({ phone, reason });
}
