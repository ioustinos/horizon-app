// validate-breakfast.js
// Called by GonnaOrder to validate breakfast entitlement.
//
// POST /api/validate-breakfast
// Body: full GonnaOrder order object (OrderResponse).
// May arrive as a bare object or wrapped in an array (e.g. n8n test captures).
//
// Validation logic:
//   1. Parse the GonnaOrder order payload (unwrap array if needed)
//   2. Extract storeId, room mapping ID (location.externalId), wishTime
//   3. Identify breakfast items: top-level orderItems whose offer has
//      offer.countAgainstSlot >= 1 (per GonnaOrder convention). Modifiers
//      are NOT counted.
//   4. Sum their quantities → covers requested
//   5. Find the Horizon store by gonnaorder_store_id
//   6. Find the room by its internal ID (room mapping ID = rooms.id)
//   7a. If room platform = "other" → entitled = max_capacity (no bookings needed)
//   7b. Otherwise → find confirmed bookings with breakfast_included covering the wish date
//   8. Consumed-cover check: sum covers from orders ALREADY CONSUMED for that
//      room+date — i.e. status 'submitted'/'fulfilled' — EXCLUDING the current
//      order UUID. Bare 'validated' menu-checks do NOT count (see below).
//   9. Allow if (already consumed + new requested) ≤ entitled guest count
//  10. Save this order as 'validated' (tentative). It only becomes a real
//      consumed slot when the after-order webhook receives ORDER_SUBMITTED.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const innerHandler = async (event) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return error(405, 'Method not allowed');
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return error(400, 'Invalid JSON body');
  }

  // Some test captures (e.g. n8n) wrap the order in an array. Unwrap it.
  const order = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!order || typeof order !== 'object') {
    return error(400, 'Empty or malformed order payload');
  }

  // ── Extract key fields from order ─────────────────────────────────────────
  const goStoreId   = String(order.storeId || '');
  const goOrderUuid = order.orderUuid || order.uuid || '';
  const wishTime    = order.wishTime;

  // Room mapping ID lives at order.location.externalId in the standard
  // GonnaOrder payload. Fall back to legacy/flat shapes just in case.
  const goRoomId = extractRoomId(order);

  if (!goStoreId) return error(400, 'Missing storeId in order');
  if (!goRoomId)  return error(400, 'Missing location.externalId in order');
  if (!wishTime)  return error(400, 'Missing wishTime in order');

  const wishDate = String(wishTime).split('T')[0];

  // ── Identify breakfast items ──────────────────────────────────────────────
  // Convention: an offer with offer.countAgainstSlot >= 1 is a breakfast
  // item. Only TOP-LEVEL orderItems are considered; modifiers are ignored.
  const breakfastItems = (order.orderItems || []).filter(item => {
    const offer = item.offer;
    if (!offer || typeof offer !== 'object') return false;
    return typeof offer.countAgainstSlot === 'number' && offer.countAgainstSlot >= 1;
  });

  const breakfastQty = breakfastItems.reduce(
    (sum, item) => sum + (item.quantity || 1), 0
  );

  if (breakfastQty === 0) {
    return ok({
      valid: true,
      reason: 'no_breakfast_items',
      entitled: null,
      requested: 0,
      message: 'No breakfast items found in order.',
    });
  }

  // ── Find the store ────────────────────────────────────────────────────────
  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('id, name')
    .eq('gonnaorder_store_id', goStoreId)
    .single();

  if (storeErr || !store) {
    return error(404, `Store not found for storeId: ${goStoreId}`);
  }

  // ── Find the room by external mapping id ──────────────────────────────────
  // GonnaOrder's location.externalId may be either:
  //   - the platform_id (e.g. HostHub rental id) — preferred, stable across
  //     Horizon data wipes and re-onboarding
  //   - the Horizon rooms.id (UUID) — fallback for 'Other (max-pax)' rooms
  //     that have no platform integration.
  // We can't .or() across both because Postgres rejects non-UUID strings
  // when matched against a uuid column; instead we route by format.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lookupCol = UUID_RE.test(goRoomId) ? 'id' : 'platform_id';
  // Normalize case for platform_id matches: GonnaOrder validation forces
  // uppercase Table Name / External Id, but we store platform_id lowercase
  // as the booking platform returns it. Normalize the inbound value so the
  // lookup hits regardless.
  const lookupValue = lookupCol === 'platform_id' ? goRoomId.toLowerCase() : goRoomId;
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .select('id, name, platform, max_capacity, platform_id')
    .eq('store_id', store.id)
    .eq(lookupCol, lookupValue)
    .maybeSingle();

  if (roomErr) {
    console.error('Room lookup error:', roomErr);
    return error(500, 'Room lookup failed');
  }
  if (!room) {
    return ok({
      valid: false,
      reason: 'no_room_match',
      entitled: 0,
      requested: breakfastQty,
      message: `No room found with ${lookupCol}="${goRoomId}" under store "${store.name}".`,
    });
  }

  // ── Determine entitled count ───────────────────────────────────────────────
  let entitled = 0;
  let matchedBooking = null;

  if (room.platform === 'other') {
    // "Other (Max Pax)" rooms: entitled = max_capacity, no bookings needed
    if (!room.max_capacity || room.max_capacity <= 0) {
      return ok({
        valid: false,
        reason: 'no_capacity_set',
        entitled: 0,
        requested: breakfastQty,
        message: `Room "${room.name}" is a max-pax room but has no capacity configured.`,
      });
    }
    entitled = room.max_capacity;
  } else {
    // ── Find active bookings covering wishDate ──────────────────────────────
    // Breakfast window = (check_in, check_out] — i.e. the mornings AFTER
    // arrival, including checkout morning. For a 1→4 Jun stay (3 nights)
    // breakfast is served on 2, 3 and 4 Jun. We do NOT serve breakfast on
    // arrival morning (guests haven't checked in yet) and we DO serve it on
    // checkout morning (standard hotel practice).
    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select('id, guest_count, check_in, check_out, breakfast_included')
      .eq('room_id', room.id)
      .eq('status', 'confirmed')
      .eq('breakfast_included', true)
      .lt('check_in', wishDate)
      .gte('check_out', wishDate);

    if (bErr) {
      console.error('Booking lookup error:', bErr);
      return error(500, 'Booking lookup failed');
    }

    if (!bookings?.length) {
      const result = {
        valid: false,
        reason: 'no_booking_found',
        entitled: 0,
        requested: breakfastQty,
        message: `No active breakfast-included booking found for ${wishDate} at "${room.name}".`,
      };
      await saveOrder(goOrderUuid, store.id, room.id, null, goRoomId, wishDate, breakfastQty, 'rejected', 'no_booking_found', order);
      return ok(result);
    }

    entitled = bookings.reduce((sum, b) => sum + b.guest_count, 0);
    matchedBooking = bookings[0];
  }

  // ── Double-order check ────────────────────────────────────────────────────
  // How many covers have actually been CONSUMED today for this room?
  // A breakfast is only consumed once the guest places the order — i.e.
  // GonnaOrder fires ORDER_SUBMITTED (→ status 'submitted'), later
  // ORDER_CLOSED (→ 'fulfilled'). Bare 'validated' rows are just menu-checks
  // (the customer browsing their cart) and must NOT count: otherwise an
  // abandoned cart would permanently hold the slot. Cancelled orders are
  // released and excluded automatically. EXCLUDE the current order UUID too,
  // so a re-check of the same order never counts against itself.
  let existingQuery = supabase
    .from('orders')
    .select('covers_requested')
    .eq('room_id', room.id)
    .eq('wish_date', wishDate)
    .in('status', ['submitted', 'fulfilled']);

  if (goOrderUuid) {
    existingQuery = existingQuery.neq('go_order_uuid', goOrderUuid);
  }

  const { data: existingOrders, error: ordErr } = await existingQuery;

  if (ordErr) {
    console.error('Double-order check error:', ordErr);
    return error(500, 'Double-order check failed');
  }

  const alreadyValidated = (existingOrders || []).reduce(
    (sum, o) => sum + o.covers_requested, 0
  );

  const totalAfterThis = alreadyValidated + breakfastQty;

  if (totalAfterThis > entitled) {
    const reason = room.platform === 'other' ? 'exceeds_max_pax' : 'exceeds_entitlement';
    const result = {
      valid: false,
      reason,
      entitled,
      requested: breakfastQty,
      already_validated: alreadyValidated,
      remaining: Math.max(0, entitled - alreadyValidated),
      message: `Your room includes ${entitled} breakfasts.\nYou have selected ${breakfastQty}, which is more than your included allowance.\nPlease select up to ${entitled - alreadyValidated} breakfasts.`,
    };
    await saveOrder(goOrderUuid, store.id, room.id, matchedBooking?.id || null, goRoomId, wishDate, breakfastQty, 'rejected', reason, order);
    return ok(result);
  }

  // ── Success ───────────────────────────────────────────────────────────────
  const successReason = room.platform === 'other' ? 'max_pax_match' : 'booking_match';
  await saveOrder(goOrderUuid, store.id, room.id, matchedBooking?.id || null, goRoomId, wishDate, breakfastQty, 'validated', successReason, order);

  const response = {
    valid: true,
    reason: successReason,
    entitled,
    requested: breakfastQty,
    already_validated: alreadyValidated,
    remaining: entitled - totalAfterThis,
    room_name: room.name,
  };

  if (matchedBooking) {
    response.check_in = matchedBooking.check_in;
    response.check_out = matchedBooking.check_out;
    response.bookings_matched = 1;
  }

  return ok(response);
};

// ── Helpers ─────────────────────────────────────────────────────────────────

// Extract the room mapping ID from the order payload.
// Preferred: order.location.externalId (object form, current GonnaOrder schema).
// Fallbacks (defensive): order.locationExternalId (flat), order.location (string).
function extractRoomId(order) {
  if (order.location && typeof order.location === 'object') {
    if (order.location.externalId) return String(order.location.externalId);
  }
  if (order.locationExternalId) return String(order.locationExternalId);
  if (typeof order.location === 'string' && order.location) return order.location;
  return '';
}

async function saveOrder(goOrderUuid, storeId, roomId, bookingId, goLocationId, wishDate, coversRequested, status, reason, rawPayload) {
  if (!goOrderUuid) return;

  try {
    // The order lifecycle (submitted → fulfilled / cancelled) is owned by the
    // after-order webhook. Validation only owns the tentative 'validated' /
    // 'rejected' states. If this order has already progressed past validation,
    // a (re-)validation must NOT reset its status — that would un-consume a
    // placed order or un-release a cancelled one. In that case just refresh
    // the captured covers + payload and leave the lifecycle status intact.
    const { data: existing } = await supabase
      .from('orders')
      .select('id, status')
      .eq('go_order_uuid', goOrderUuid)
      .maybeSingle();

    const LIFECYCLE_OWNED = ['submitted', 'fulfilled', 'cancelled'];
    if (existing && LIFECYCLE_OWNED.includes(existing.status)) {
      await supabase
        .from('orders')
        .update({ covers_requested: coversRequested, raw_payload: rawPayload })
        .eq('id', existing.id);
      return;
    }

    await supabase
      .from('orders')
      .upsert({
        go_order_uuid: goOrderUuid,
        store_id: storeId,
        room_id: roomId,
        booking_id: bookingId,
        go_location_id: goLocationId,
        wish_date: wishDate,
        covers_requested: coversRequested,
        status,
        validation_reason: reason,
        raw_payload: rawPayload,
      }, { onConflict: 'go_order_uuid' });
  } catch (err) {
    console.error('Failed to save order:', err);
  }
}

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
// regardless of outcome (early returns, validation results, errors), so we
// can debug in production without console.log spelunking on Netlify.
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

  // Best-effort log; never let logging break the response to GonnaOrder.
  try {
    let parsedBody = null;
    try { parsedBody = JSON.parse(event.body || 'null'); } catch { parsedBody = { _raw: event.body }; }
    let parsedResp = null;
    try { parsedResp = JSON.parse(result?.body || 'null'); } catch { parsedResp = { _raw: result?.body }; }
    await supabase.from('webhook_logs').insert({
      endpoint: '/api/validate-breakfast',
      http_method: event.httpMethod,
      request_headers: event.headers || null,
      request_body: parsedBody,
      response_status: result?.statusCode ?? 500,
      response_body: parsedResp,
      duration_ms: duration,
      ip: event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'] || null,
    });
  } catch (logErr) {
    console.error('webhook_logs insert failed:', logErr);
  }

  return result;
};
