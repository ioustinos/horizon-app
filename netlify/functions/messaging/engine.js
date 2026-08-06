// messaging/engine.js
// The guest-messaging sweep: called hourly by guest-messaging-background.js
// (and manually via force-messaging.js). For every store with
// messaging_enabled, at that store's configured Athens hours:
//
//   reminder_send_hour → breakfast reminders ("simple + stop" rule):
//     A phone gets tonight's reminder when ALL of these hold:
//       - it has a real order (submitted/fulfilled) whose wish_date is today
//         or up to 2 days back (the chain window)
//       - it has NO order with wish_date = tomorrow (nothing to remind about
//         otherwise)
//       - fewer than 2 reminders were already sent since its last order
//         (stop after 2 consecutive ignored reminders; a new order resets)
//       - no reminder was already sent today (idempotency)
//       - the phone hasn't opted out
//
//   review_send_hour → review requests:
//     A phone gets the rating-buttons message when it has an order with
//     wish_date = today, hasn't been asked in the last 30 days ("one ask per
//     stay" approximation — we mostly can't see check-out dates), wasn't
//     already asked today, and hasn't opted out.
//
// DRY-RUN: when Twilio isn't configured (twilioConfigured() false) the full
// audience selection still runs and every would-be send is logged to
// guest_messages with status 'dry_run'. This lets us verify the audience
// logic in production before the Twilio account even exists.

import {
  supabase, twilioConfigured, contentSidFor, normalizePhone, pickLanguage,
  firstNameOf, athensNow, addDays, sendWhatsAppTemplate, logGuestMessage,
} from './_shared.js';

// Statuses that count as "a reminder the guest actually received/ignored".
// dry_run never reached anyone; failed/undelivered didn't either.
const COUNTABLE = ['queued', 'accepted', 'sent', 'delivered', 'read'];
const REAL_ORDER_STATUSES = ['submitted', 'fulfilled'];
const MAX_CONSECUTIVE_IGNORED = 2;
const REVIEW_SUPPRESSION_DAYS = 30;

export async function runSweep({ hourOverride = null, storeIdFilter = null, now = new Date() } = {}) {
  const { date: today, hour: athensHour, startOfDayUtc } = athensNow(now);
  const hour = hourOverride ?? athensHour;
  const tomorrow = addDays(today, 1);
  const dryRun = !twilioConfigured();

  let query = supabase.from('stores')
    .select('id, name, public_link, google_review_link, messaging_enabled, reminder_send_hour, review_send_hour')
    .eq('messaging_enabled', true);
  if (storeIdFilter) query = query.eq('id', storeIdFilter);
  const { data: stores, error } = await query;
  if (error) throw new Error(`stores query failed: ${error.message}`);

  const summary = { athensHour: hour, today, dryRun, stores: [] };

  for (const store of stores || []) {
    const s = { store: store.name, storeId: store.id, reminders: null, reviews: null };
    try {
      if (store.reminder_send_hour === hour) {
        s.reminders = await runReminders(store, { today, tomorrow, startOfDayUtc, dryRun });
      }
      if (store.review_send_hour === hour) {
        s.reviews = await runReviewRequests(store, { today, startOfDayUtc, dryRun, now });
      }
    } catch (err) {
      s.error = err.message;
      console.error(`messaging sweep failed for store ${store.name}:`, err);
    }
    if (s.reminders || s.reviews || s.error) summary.stores.push(s);
  }

  console.log('guest-messaging sweep:', JSON.stringify(summary));
  return summary;
}

// ─── Audience helpers ───────────────────────────────────────────────────────

// Map phone → { name, lastOrder, hasTomorrowOrder, todayOrderId } from a set
// of order rows (raw_payload.customerPhoneNumber is present on 100% of orders).
function groupOrdersByPhone(orders, { today, tomorrow }) {
  const byPhone = new Map();
  for (const o of orders) {
    const phone = normalizePhone(o.raw_payload?.customerPhoneNumber);
    if (!phone) continue;
    let entry = byPhone.get(phone);
    if (!entry) {
      entry = { phone, name: null, lastOrder: null, hasTomorrowOrder: false, todayOrderId: null };
      byPhone.set(phone, entry);
    }
    if (o.raw_payload?.customerName && !entry.name) entry.name = o.raw_payload.customerName;
    if (o.wish_date === tomorrow) entry.hasTomorrowOrder = true;
    if (o.wish_date === today) entry.todayOrderId = entry.todayOrderId || o.id;
    // lastOrder = most recent order whose breakfast day is today or earlier
    if (o.wish_date <= today) {
      if (!entry.lastOrder || o.created_at > entry.lastOrder.created_at) entry.lastOrder = o;
    }
  }
  return byPhone;
}

async function optedOutSet(phones) {
  if (!phones.length) return new Set();
  const { data } = await supabase.from('message_optouts').select('phone').in('phone', phones);
  return new Set((data || []).map(r => r.phone));
}

// ─── Breakfast reminders ────────────────────────────────────────────────────

async function runReminders(store, { today, tomorrow, startOfDayUtc, dryRun }) {
  const windowStart = addDays(today, -MAX_CONSECUTIVE_IGNORED);

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, wish_date, created_at, raw_payload')
    .eq('store_id', store.id)
    .in('status', REAL_ORDER_STATUSES)
    .gte('wish_date', windowStart)
    .lte('wish_date', tomorrow);
  if (error) throw new Error(`orders query failed: ${error.message}`);

  const byPhone = groupOrdersByPhone(orders || [], { today, tomorrow });
  const phones = [...byPhone.keys()];
  if (!phones.length) return { candidates: 0, sent: 0 };

  const optouts = await optedOutSet(phones);

  // Reminder history for these phones (last few days is plenty).
  const historyFrom = new Date(startOfDayUtc.getTime() - 4 * 86400_000).toISOString();
  const { data: history } = await supabase
    .from('guest_messages')
    .select('phone, status, sent_at')
    .eq('store_id', store.id)
    .eq('template', 'breakfast_reminder')
    .in('phone', phones)
    .gte('sent_at', historyFrom);

  const result = { candidates: phones.length, sent: 0, skipped: {} };
  const skip = (reason) => { result.skipped[reason] = (result.skipped[reason] || 0) + 1; };

  for (const entry of byPhone.values()) {
    if (entry.hasTomorrowOrder) { skip('has_tomorrow_order'); continue; }
    if (!entry.lastOrder) { skip('no_recent_order'); continue; }
    if (optouts.has(entry.phone)) { skip('opted_out'); continue; }

    const mine = (history || []).filter(h => h.phone === entry.phone);
    const sentToday = mine.some(h => h.sent_at >= startOfDayUtc.toISOString());
    if (sentToday) { skip('already_sent_today'); continue; }

    const sinceLastOrder = mine.filter(h =>
      h.sent_at > entry.lastOrder.created_at && COUNTABLE.includes(h.status)
    ).length;
    if (sinceLastOrder >= MAX_CONSECUTIVE_IGNORED) { skip('stop_rule'); continue; }

    const language = pickLanguage(entry.phone);
    const firstName = firstNameOf(entry.name);
    const contentSid = contentSidFor('breakfast_reminder', language);

    const row = {
      store_id: store.id,
      order_id: entry.lastOrder.id,
      phone: entry.phone,
      direction: 'outbound',
      channel: 'whatsapp',
      template: 'breakfast_reminder',
      language,
      meta: {
        athens_date: today,
        first_name: firstName,
        last_order_wish_date: entry.lastOrder.wish_date,
        reminders_since_last_order: sinceLastOrder,
        order_link: store.public_link || null,
      },
    };

    if (dryRun || !contentSid) {
      await logGuestMessage({
        ...row,
        status: 'dry_run',
        body: dryRun ? '[dry-run: Twilio not configured]' : '[dry-run: template Content SID not configured]',
      });
      result.sent += 1; // counted as an audience hit
      continue;
    }

    try {
      const { sid, status } = await sendWhatsAppTemplate({
        to: entry.phone,
        contentSid,
        variables: { 1: firstName },
      });
      await logGuestMessage({ ...row, message_sid: sid, status: status || 'queued' });
      result.sent += 1;
    } catch (err) {
      await logGuestMessage({ ...row, status: 'failed', error_code: 'send_error', body: err.message });
      skip('send_error');
    }
  }
  return result;
}

// ─── Review requests ────────────────────────────────────────────────────────

async function runReviewRequests(store, { today, startOfDayUtc, dryRun, now }) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, wish_date, created_at, raw_payload')
    .eq('store_id', store.id)
    .in('status', REAL_ORDER_STATUSES)
    .eq('wish_date', today);
  if (error) throw new Error(`orders query failed: ${error.message}`);

  const byPhone = new Map();
  for (const o of orders || []) {
    const phone = normalizePhone(o.raw_payload?.customerPhoneNumber);
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, { phone, name: o.raw_payload?.customerName, orderId: o.id });
  }
  const phones = [...byPhone.keys()];
  if (!phones.length) return { candidates: 0, sent: 0 };

  const optouts = await optedOutSet(phones);

  const suppressionFrom = new Date(now.getTime() - REVIEW_SUPPRESSION_DAYS * 86400_000).toISOString();
  const { data: history } = await supabase
    .from('guest_messages')
    .select('phone, status, sent_at')
    .eq('template', 'review_request')
    .in('phone', phones)
    .gte('sent_at', suppressionFrom);

  const result = { candidates: phones.length, sent: 0, skipped: {} };
  const skip = (reason) => { result.skipped[reason] = (result.skipped[reason] || 0) + 1; };

  for (const entry of byPhone.values()) {
    if (optouts.has(entry.phone)) { skip('opted_out'); continue; }

    const mine = (history || []).filter(h => h.phone === entry.phone);
    if (mine.some(h => h.sent_at >= startOfDayUtc.toISOString())) { skip('already_sent_today'); continue; }
    if (mine.some(h => COUNTABLE.includes(h.status))) { skip('asked_recently'); continue; }

    const language = pickLanguage(entry.phone);
    const firstName = firstNameOf(entry.name);
    const contentSid = contentSidFor('review_request', language);

    const row = {
      store_id: store.id,
      order_id: entry.orderId,
      phone: entry.phone,
      direction: 'outbound',
      channel: 'whatsapp',
      template: 'review_request',
      language,
      meta: { athens_date: today, first_name: firstName },
    };

    if (dryRun || !contentSid) {
      await logGuestMessage({
        ...row,
        status: 'dry_run',
        body: dryRun ? '[dry-run: Twilio not configured]' : '[dry-run: template Content SID not configured]',
      });
      result.sent += 1;
      continue;
    }

    try {
      const { sid, status } = await sendWhatsAppTemplate({
        to: entry.phone,
        contentSid,
        variables: { 1: firstName },
      });
      await logGuestMessage({ ...row, message_sid: sid, status: status || 'queued' });
      result.sent += 1;
    } catch (err) {
      await logGuestMessage({ ...row, status: 'failed', error_code: 'send_error', body: err.message });
      skip('send_error');
    }
  }
  return result;
}
