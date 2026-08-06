// whatsapp-inbound.js
// Twilio inbound webhook — fires when a guest sends us a WhatsApp message
// (quick-reply button tap, free text, or STOP). Configure in Twilio console:
// sender → "When a message comes in" →
//   https://horizon-app-is.netlify.app/.netlify/functions/whatsapp-inbound
// (point Twilio at the DIRECT function path, not an /api/* redirect — the
// signature is computed over the exact URL Twilio calls.)
//
// Flow:
//   - STOP-style message  → global opt-out for that phone + confirmation
//   - rating button tap   → save to reviews; 3/3 → send Google review link,
//                           1-2/3 → ask what went wrong (private)
//   - other free text     → attach as comment to the guest's recent review
//                           (the private-feedback loop for unhappy guests)
//
// Every inbound payload is logged in full to guest_messages.meta AND to
// webhook_logs — deliberately, because Twilio's quick-reply param name
// (ButtonPayload vs ButtonText/Payload) has varied across API versions.
// Check the first real tap's logged payload and adjust BUTTON_PARAM_ORDER
// if needed.

import {
  supabase, validateTwilioSignature, normalizePhone, pickLanguage,
  twilioConfigured, sendWhatsAppSession, logGuestMessage, optOut, isOptedOut,
} from './messaging/_shared.js';

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'cancel', 'στοπ', 'διαγραφη', 'διαγραφή']);

// Try these params in order for the quick-reply id (see header comment).
const BUTTON_PARAM_ORDER = ['ButtonPayload', 'Payload', 'ButtonText'];

// Fallback mapping when only the button LABEL arrives (ButtonText).
const LABEL_TO_RATING = [
  { match: /great|😍|τελει|υπεροχ/i, rating: 3 },
  { match: /okay|ok|🙂|καλ/i,        rating: 2 },
  { match: /not good|bad|😞|όχι|οχι/i, rating: 1 },
];

const innerHandler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!validateTwilioSignature(event, 'whatsapp-inbound')) {
    return { statusCode: 403, body: 'Invalid Twilio signature' };
  }

  const params = Object.fromEntries(new URLSearchParams(event.body || ''));
  const phone = normalizePhone((params.From || '').replace(/^whatsapp:/, ''));
  const body = (params.Body || '').trim();

  if (!phone) return twiml(); // nothing we can do without a sender

  // Quick-reply id: rate_1 / rate_2 / rate_3 (or label fallback).
  let buttonRaw = null;
  for (const key of BUTTON_PARAM_ORDER) {
    if (params[key]) { buttonRaw = params[key]; break; }
  }
  let rating = null;
  if (/^rate_[123]$/.test(buttonRaw || '')) {
    rating = Number(buttonRaw.split('_')[1]);
  } else if (buttonRaw) {
    rating = LABEL_TO_RATING.find(m => m.match.test(buttonRaw))?.rating ?? null;
  }

  // Log the raw inbound message (full payload in meta — see header comment).
  await logGuestMessage({
    phone,
    direction: 'inbound',
    channel: 'whatsapp',
    template: 'inbound',
    language: pickLanguage(phone),
    message_sid: params.MessageSid || null,
    status: 'received',
    body: body || buttonRaw || null,
    meta: { twilio_params: params, parsed_rating: rating },
  });

  const lang = pickLanguage(phone);

  // ── STOP handling ─────────────────────────────────────────────────────────
  if (!rating && STOP_WORDS.has(body.toLowerCase())) {
    await optOut(phone, `guest replied "${body}"`);
    await reply(phone, lang === 'el'
      ? 'Εντάξει, δεν θα λαμβάνετε άλλα μηνύματα από εμάς. Καλή διαμονή! 🙏'
      : "Okay — you won't receive any more messages from us. Enjoy your stay! 🙏",
      { allowOptedOut: true });
    return twiml();
  }

  // Context: the most recent review_request we sent this phone tells us which
  // store/order this conversation is about.
  const { data: lastAsk } = await supabase
    .from('guest_messages')
    .select('store_id, order_id')
    .eq('phone', phone)
    .eq('template', 'review_request')
    .eq('direction', 'outbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Rating button tap ─────────────────────────────────────────────────────
  if (rating) {
    await supabase.from('reviews').insert({
      store_id: lastAsk?.store_id ?? null,
      order_id: lastAsk?.order_id ?? null,
      phone,
      rating,
    });

    if (rating === 3) {
      let link = null;
      if (lastAsk?.store_id) {
        const { data: store } = await supabase
          .from('stores').select('google_review_link').eq('id', lastAsk.store_id).maybeSingle();
        link = store?.google_review_link || null;
      }
      const thanks = lang === 'el'
        ? `Ευχαριστούμε πολύ! 🙏${link ? ` Θα σήμαινε πολλά για εμάς αν το μοιραζόσασταν κι εδώ: ${link}` : ''}`
        : `Thank you so much! 🙏${link ? ` It would mean a lot if you shared it publicly: ${link}` : ''}`;
      await reply(phone, thanks);
    } else {
      await reply(phone, lang === 'el'
        ? 'Λυπούμαστε που δεν μείνατε ευχαριστημένοι. 😔 Τι θα μπορούσαμε να κάνουμε καλύτερα; Απαντήστε εδώ — η ομάδα διαβάζει κάθε μήνυμα.'
        : "Sorry to hear that. 😔 What could we improve? Just reply here — the team reads every message.");
    }
    return twiml();
  }

  // ── Free text → private comment on the guest's recent review ─────────────
  if (body) {
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: recentReview } = await supabase
      .from('reviews')
      .select('id, comment')
      .eq('phone', phone)
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentReview) {
      const combined = recentReview.comment ? `${recentReview.comment}\n---\n${body}` : body;
      await supabase.from('reviews')
        .update({ comment: combined, updated_at: new Date().toISOString() })
        .eq('id', recentReview.id);
    } else {
      // Comment with no prior rating — still worth capturing.
      await supabase.from('reviews').insert({
        store_id: lastAsk?.store_id ?? null,
        order_id: lastAsk?.order_id ?? null,
        phone,
        comment: body,
      });
    }
  }

  return twiml();
};

// Session reply inside the 24h window the guest just opened. Never throws —
// a failed thank-you must not fail the webhook.
async function reply(phone, text, { allowOptedOut = false } = {}) {
  if (!twilioConfigured()) return;
  if (!allowOptedOut && await isOptedOut(phone)) return;
  try {
    const { sid, status } = await sendWhatsAppSession({ to: phone, body: text });
    await logGuestMessage({
      phone, direction: 'outbound', channel: 'whatsapp', template: 'session',
      language: pickLanguage(phone), message_sid: sid, status: status || 'queued', body: text,
    });
  } catch (err) {
    console.error('session reply failed:', err.message);
  }
}

function twiml() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: '<Response></Response>',
  };
}

// Capture-everything wrapper → webhook_logs (same pattern as after-order.js).
export const handler = async (event) => {
  const start = Date.now();
  let result;
  try {
    result = await innerHandler(event);
  } catch (err) {
    console.error('whatsapp-inbound crashed:', err);
    result = { statusCode: 500, body: '<Response></Response>', headers: { 'Content-Type': 'text/xml' } };
  }
  try {
    await supabase.from('webhook_logs').insert({
      endpoint: '/whatsapp-inbound',
      http_method: event.httpMethod,
      request_headers: { 'x-twilio-signature': event.headers?.['x-twilio-signature'] || null },
      request_body: Object.fromEntries(new URLSearchParams(event.body || '')),
      response_status: result?.statusCode ?? 500,
      response_body: null,
      duration_ms: Date.now() - start,
      ip: event.headers?.['x-forwarded-for'] || null,
    });
  } catch (logErr) {
    console.error('webhook_logs insert failed (whatsapp-inbound):', logErr);
  }
  return result;
};
