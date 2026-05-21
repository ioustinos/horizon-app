// after-order.js
// GonnaOrder order-lifecycle webhook. Receives one POST per state change on
// an order (submitted, received, updated, closed, cancelled, …).
//
// POST /api/after-order
// Body: lightweight event payload from GonnaOrder, e.g.:
//   { uuid, eventType, storeId, storeAlias, locale, currency, customer,
//     wishTime, createdAt, updatedAt, locationLabel, ... }
//
// Consume-on-submit model: validate-breakfast.js saves each menu-check as a
// tentative 'validated' row, which does NOT count against the room's daily
// entitlement. A breakfast slot is only CONSUMED when the guest actually
// places the order — i.e. GonnaOrder fires ORDER_SUBMITTED. This handler is
// what promotes the order from a tentative check to a real consumed slot,
// and releases it on cancellation. The double-order check in
// validate-breakfast counts only 'submitted' + 'fulfilled' orders.
//
// We match the GonnaOrder order to our row by its order UUID (same UUID is
// reused from menu-check through submission), so the covers quantity captured
// at validation time is carried forward — the lightweight after-order payload
// doesn't include item quantities.
//
// Event handling:
//   ORDER_SUBMITTED  → orders.status = 'submitted'  (consume the slot)
//   ORDER_RECEIVED   → orders.status = 'submitted'  (backstop if SUBMITTED missed)
//   ORDER_CLOSED     → orders.status = 'fulfilled'  (still consumed)
//   ORDER_COMPLETED  → orders.status = 'fulfilled'  (forward-compat alias)
//   ORDER_CANCELLED  → orders.status = 'cancelled'  (release the slot)
//   ORDER_REJECTED   → orders.status = 'cancelled'  (release the slot)
//   everything else  → no-op ack (e.g. ORDER_UPDATED while building the cart)
//
// Latest-event-wins: GonnaOrder may reverse a cancellation (e.g. a store
// reinstates the order); we trust whatever event arrives last. 'submitted'
// and 'fulfilled' both count, so out-of-order delivery between them never
// changes the entitlement math.
//
// Idempotent: re-running the same event over the same order is safe.
// Order-not-found: ack with 200 + action: 'skipped' (most GonnaOrder
// orders aren't breakfast orders and never had a row written by us).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GonnaOrder eventType → orders.status. Anything not in this map (e.g.
// ORDER_UPDATED, ORDER_ITEM_UPDATED) is a cart-building progress signal and
// is acknowledged but ignored.
const EVENT_TO_STATUS = {
  ORDER_SUBMITTED: 'submitted',   // guest placed the order → consume the slot
  ORDER_RECEIVED:  'submitted',   // backstop if ORDER_SUBMITTED is ever missed
  ORDER_CLOSED:    'fulfilled',   // order completed → still consumed
  ORDER_COMPLETED: 'fulfilled',
  ORDER_CANCELLED: 'cancelled',   // released — frees the slot
  ORDER_REJECTED:  'cancelled',
};

const innerHandler = async (event) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return error(405, 'Method not allowed');
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return error(400, 'Invalid JSON body');
  }

  const orderUuid = payload?.uuid;
  const eventType = payload?.eventType;

  if (!orderUuid) return error(400, 'Missing uuid in payload');
  if (!eventType) return error(400, 'Missing eventType in payload');

  // ── Cart-building / non-actionable events: ack and move on ────────────────
  const newStatus = EVENT_TO_STATUS[eventType];
  if (!newStatus) {
    return ok({
      acknowledged: true,
      action: 'ignored',
      eventType,
      message: `Event type "${eventType}" does not change consumption — no status change.`,
    });
  }

  // ── Find the order row (most GonnaOrder orders won't have one) ────────────
  const { data: existingOrder, error: findErr } = await supabase
    .from('orders')
    .select('id, status')
    .eq('go_order_uuid', orderUuid)
    .maybeSingle();

  if (findErr) {
    console.error('Order lookup error:', findErr);
    return error(500, 'Order lookup failed');
  }

  if (!existingOrder) {
    // Not a breakfast order, or never validated through us. Ack and skip.
    return ok({
      acknowledged: true,
      action: 'skipped',
      eventType,
      orderUuid,
      message: `Order ${orderUuid} not found in Horizon — likely not a breakfast order.`,
    });
  }

  // Idempotent short-circuit: same status, nothing to do.
  if (existingOrder.status === newStatus) {
    return ok({
      acknowledged: true,
      action: 'noop',
      eventType,
      orderUuid,
      status: newStatus,
      message: `Order ${orderUuid} is already "${newStatus}".`,
    });
  }

  // ── Apply the status transition ───────────────────────────────────────────
  const updateData = { status: newStatus };
  if (newStatus === 'fulfilled') {
    updateData.fulfilled_at = new Date().toISOString();
  }

  const { error: updateErr } = await supabase
    .from('orders')
    .update(updateData)
    .eq('id', existingOrder.id);

  if (updateErr) {
    console.error('Failed to update order status:', updateErr);
    return error(500, 'Failed to update order status');
  }

  return ok({
    acknowledged: true,
    action: 'updated',
    eventType,
    orderUuid,
    previousStatus: existingOrder.status,
    newStatus,
    message: `Order ${orderUuid} marked as "${newStatus}".`,
  });
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function ok(data) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(data),
  };
}

function error(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify({ error: message }),
  };
}

// Capture-everything wrapper. Logs every inbound request to webhook_logs
// regardless of outcome so we can debug in production without console.log
// spelunking on Netlify.
export const handler = async (event) => {
  const start = Date.now();
  let result;
  try {
    result = await innerHandler(event);
  } catch (err) {
    result = {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, stack: err.stack }),
    };
  }
  const duration = Date.now() - start;

  try {
    let parsedBody = null;
    try { parsedBody = JSON.parse(event.body || 'null'); } catch { parsedBody = { _raw: event.body }; }
    let parsedResp = null;
    try { parsedResp = JSON.parse(result?.body || 'null'); } catch { parsedResp = { _raw: result?.body }; }
    await supabase.from('webhook_logs').insert({
      endpoint: '/api/after-order',
      http_method: event.httpMethod,
      request_headers: event.headers || null,
      request_body: parsedBody,
      response_status: result?.statusCode ?? 500,
      response_body: parsedResp,
      duration_ms: duration,
      ip: event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'] || null,
    });
  } catch (logErr) {
    console.error('webhook_logs insert failed (after-order):', logErr);
  }

  return result;
};
