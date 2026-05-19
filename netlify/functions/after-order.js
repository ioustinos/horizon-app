// after-order.js
// GonnaOrder order-lifecycle webhook. Receives one POST per state change on
// an order (submitted, received, updated, closed, cancelled, …).
//
// POST /api/after-order
// Body: lightweight event payload from GonnaOrder, e.g.:
//   { uuid, eventType, storeId, storeAlias, locale, currency, customer,
//     wishTime, createdAt, updatedAt, locationLabel, ... }
//
// Slot-reservation model: validate-breakfast.js saves each successful order
// with status = 'validated'. The double-order check in that endpoint counts
// 'validated' and 'fulfilled' orders against the room's daily entitlement.
// So a slot is held from validation until the order reaches a terminal
// state in GonnaOrder. This handler is what writes those terminal states.
//
// Event handling:
//   ORDER_CANCELLED  → orders.status = 'cancelled'  (release the slot)
//   ORDER_REJECTED   → orders.status = 'cancelled'  (release the slot)
//   ORDER_CLOSED     → orders.status = 'fulfilled'  (slot remains counted)
//   ORDER_COMPLETED  → orders.status = 'fulfilled'  (forward-compat alias)
//   everything else  → no-op ack (slot stays reserved while order is live)
//
// Latest-event-wins: GonnaOrder may reverse a cancellation (e.g. a store
// reinstates the order); we trust whatever event arrives last. The validator
// only inspects status at validation time, so any after-the-fact state
// changes don't grant extra slots — they only update reporting.
//
// Idempotent: re-running the same event over the same order is safe.
// Order-not-found: ack with 200 + action: 'skipped' (most GonnaOrder
// orders aren't breakfast orders and never had a row written by us).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GonnaOrder eventType → orders.status. Anything not in this map is
// treated as a non-terminal progress signal and ignored.
const EVENT_TO_STATUS = {
  ORDER_CANCELLED: 'cancelled',
  ORDER_REJECTED:  'cancelled',
  ORDER_CLOSED:    'fulfilled',
  ORDER_COMPLETED: 'fulfilled',
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

  // ── Non-terminal events: ack and move on ──────────────────────────────────
  const newStatus = EVENT_TO_STATUS[eventType];
  if (!newStatus) {
    return ok({
      acknowledged: true,
      action: 'ignored',
      eventType,
      message: `Event type "${eventType}" is not a terminal state — slot remains reserved.`,
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
