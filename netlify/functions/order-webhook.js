// order-webhook.js
// Called by GonnaOrder on order lifecycle events (submitted, closed, cancelled, etc.)
//
// POST /api/order-webhook
// Body: lightweight event payload from GonnaOrder:
//   { uuid, eventType, storeId, storeAlias, ... }
//
// We care about:
//   - ORDER_COMPLETED / ORDER_CLOSED → mark order as "fulfilled"
//   - ORDER_CANCELLED → mark order as "cancelled" (frees up entitlement)
//
// All other event types are acknowledged but ignored.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Map GonnaOrder event types to our order status
const EVENT_TO_STATUS = {
  ORDER_COMPLETED: 'fulfilled',
  ORDER_CLOSED:    'fulfilled',
  ORDER_CANCELLED: 'cancelled',
  ORDER_REJECTED:  'cancelled',
};

export const handler = async (event) => {
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

  const orderUuid = payload.uuid;
  const eventType = payload.eventType;

  if (!orderUuid) {
    return error(400, 'Missing uuid in payload');
  }

  if (!eventType) {
    return error(400, 'Missing eventType in payload');
  }

  // ── Check if this is an event we act on ───────────────────────────────────
  const newStatus = EVENT_TO_STATUS[eventType];

  if (!newStatus) {
    // Acknowledge but ignore unknown/unhandled events (e.g. ORDER_SUBMITTED)
    return ok({
      acknowledged: true,
      action: 'ignored',
      eventType,
      message: `Event type "${eventType}" does not require action.`,
    });
  }

  // ── Find the order in our database ────────────────────────────────────────
  const { data: existingOrder, error: findErr } = await supabase
    .from('orders')
    .select('id, status')
    .eq('go_order_uuid', orderUuid)
    .single();

  if (findErr || !existingOrder) {
    // Order not found — it might not have been a breakfast order,
    // or it was never validated through our system. That's OK.
    return ok({
      acknowledged: true,
      action: 'skipped',
      eventType,
      message: `Order ${orderUuid} not found in Horizon — likely not a breakfast order.`,
    });
  }

  // ── Update the order status ───────────────────────────────────────────────
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
    previousStatus: existingOrder.status,
    newStatus,
    orderUuid,
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
