// whatsapp-status.js
// Twilio status callback — fires as each outbound message progresses:
// queued → sent → delivered → read, or failed/undelivered. The callback URL
// is passed per-message (StatusCallback param in messaging/_shared.js), so no
// console configuration is needed.
//
// Responsibilities:
//   1. Update the matching guest_messages row (status + error code).
//   2. SMS fallback: a breakfast reminder that fails on WhatsApp (guest has
//      no WhatsApp, error 63003/63024, etc.) is re-sent once as a plain SMS
//      with the store's order link — if TWILIO_SMS_FROM is configured.
//
// Notable error codes:
//   63016 — tried to send a free-form message outside the 24h session window
//           (should only ever happen to 'session' messages; templates fix it)
//
// NOT logged to webhook_logs: every message generates 3-4 callbacks and the
// sync_logs bloat incident taught us not to hoard low-value rows.

import {
  supabase, validateTwilioSignature, normalizePhone, pickLanguage,
  sendSms, logGuestMessage,
} from './messaging/_shared.js';

const FALLBACK_STATUSES = new Set(['failed', 'undelivered']);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!validateTwilioSignature(event, 'whatsapp-status')) {
    return { statusCode: 403, body: 'Invalid Twilio signature' };
  }

  const params = Object.fromEntries(new URLSearchParams(event.body || ''));
  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;
  if (!sid || !status) return ok();

  try {
    // 1. Update the message row.
    const { data: row } = await supabase
      .from('guest_messages')
      .update({
        status,
        error_code: params.ErrorCode || null,
        updated_at: new Date().toISOString(),
      })
      .eq('message_sid', sid)
      .select('id, phone, store_id, order_id, channel, template, language, meta')
      .maybeSingle();

    if (!row) return ok(); // unknown sid (e.g. console test message)

    // 2. SMS fallback for failed WhatsApp breakfast reminders.
    if (
      FALLBACK_STATUSES.has(status) &&
      row.channel === 'whatsapp' &&
      row.template === 'breakfast_reminder' &&
      process.env.TWILIO_SMS_FROM
    ) {
      await sendSmsFallback(row, sid);
    }
  } catch (err) {
    console.error('whatsapp-status handling failed:', err);
  }

  return ok();
};

async function sendSmsFallback(row, failedSid) {
  const phone = normalizePhone(row.phone);
  if (!phone) return;

  // Only one fallback per failed message.
  const { data: existing } = await supabase
    .from('guest_messages')
    .select('id')
    .eq('template', 'sms_fallback')
    .contains('meta', { fallback_for: failedSid })
    .maybeSingle();
  if (existing) return;

  // Order link from the store (public_link = the GonnaOrder store URL).
  let link = row.meta?.order_link || null;
  if (!link && row.store_id) {
    const { data: store } = await supabase
      .from('stores').select('public_link').eq('id', row.store_id).maybeSingle();
    link = store?.public_link || null;
  }

  const name = row.meta?.first_name || '';
  const lang = row.language || pickLanguage(phone);
  const body = lang === 'el'
    ? `Καλημέρα${name ? ` ${name}` : ''}! Θέλετε να παραγγείλετε πρωινό για αύριο;${link ? ` ${link}` : ''}`
    : `Good morning${name ? ` ${name}` : ''}! Would you like to order breakfast for tomorrow?${link ? ` ${link}` : ''}`;

  try {
    const { sid, status } = await sendSms({ to: phone, body });
    await logGuestMessage({
      store_id: row.store_id,
      order_id: row.order_id,
      phone,
      direction: 'outbound',
      channel: 'sms',
      template: 'sms_fallback',
      language: lang,
      message_sid: sid,
      status: status || 'queued',
      body,
      meta: { fallback_for: failedSid },
    });
  } catch (err) {
    console.error('SMS fallback failed:', err.message);
    await logGuestMessage({
      store_id: row.store_id,
      order_id: row.order_id,
      phone,
      direction: 'outbound',
      channel: 'sms',
      template: 'sms_fallback',
      language: lang,
      status: 'failed',
      error_code: 'send_error',
      body: err.message,
      meta: { fallback_for: failedSid },
    });
  }
}

function ok() {
  return { statusCode: 200, body: '' };
}
