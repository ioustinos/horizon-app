// validate-breakfast.js
// Called by GonnaOrder to validate breakfast entitlement.
//
// POST /api/validate-breakfast
// Body: full GonnaOrder order object (OrderResponse)
//
// Validation logic:
//   1. Parse the GonnaOrder order payload
//   2. Extract storeId, location (location_room_id), wishTime
//   3. Identify breakfast items: orderItems where offer.stockLevel === 0
//      AND offer.isStockCheckEnabled === true
//   4. Sum their quantities → covers requested
//   5. Find the Horizon store by gonnaorder_store_id
//   6. Find the facility by location_room_id
//   7. Find confirmed bookings with breakfast_included covering the wish date
//   8. Double-order check: sum already-validated covers for that facility+date
//   9. Allow if (already validated + new requested) ≤ entitled guest count
//  10. Save the order to the orders table

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
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

  let order;
  try {
    order = JSON.parse(event.body);
  } catch {
    return error(400, 'Invalid JSON body');
  }

  // ── Extract key fields from order ─────────────────────────────────────────
  const goStoreId   = String(order.storeId || '');
  const goLocation  = String(order.location || '');
  const goOrderUuid = order.uuid || '';
  const wishTime    = order.wishTime;

  if (!goStoreId) return error(400, 'Missing storeId in order');
  if (!goLocation) return error(400, 'Missing location in order');
  if (!wishTime)   return error(400, 'Missing wishTime in order');

  const wishDate = wishTime.split('T')[0];

  // ── Identify breakfast items ──────────────────────────────────────────────
  // A breakfast item is an orderItem whose nested offer has:
  //   offer.stockLevel === 0  AND  offer.isStockCheckEnabled === true
  const breakfastItems = (order.orderItems || []).filter(item => {
    const offer = item.offer;
    if (!offer) return false;
    return offer.stockLevel === 0 && offer.isStockCheckEnabled === true;
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

  // ── Find the facility by location_room_id ─────────────────────────────────
  const { data: facility, error: facErr } = await supabase
    .from('facilities')
    .select('id, name, platform, max_capacity')
    .eq('store_id', store.id)
    .eq('location_room_id', goLocation)
    .single();

  if (facErr || !facility) {
    return ok({
      valid: false,
      reason: 'no_facility_match',
      entitled: 0,
      requested: breakfastQty,
      message: `No facility found with location_room_id "${goLocation}" under store "${store.name}".`,
    });
  }

  // ── Find active bookings covering wishDate ────────────────────────────────
  // check_in ≤ wishDate < check_out
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, guest_count, check_in, check_out, breakfast_included')
    .eq('facility_id', facility.id)
    .eq('status', 'confirmed')
    .eq('breakfast_included', true)
    .lte('check_in', wishDate)
    .gt('check_out', wishDate);

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
      message: `No active breakfast-included booking found for ${wishDate} at "${facility.name}".`,
    };
    await saveOrder(goOrderUuid, store.id, facility.id, null, goLocation, wishDate, breakfastQty, 'rejected', 'no_booking_found', order);
    return ok(result);
  }

  // Sum entitled guests across all matching bookings for this facility
  const entitled = bookings.reduce((sum, b) => sum + b.guest_count, 0);
  const matchedBooking = bookings[0]; // primary booking

  // ── Double-order check ────────────────────────────────────────────────────
  // How many covers have already been validated today for this facility?
  const { data: existingOrders, error: ordErr } = await supabase
    .from('orders')
    .select('covers_requested')
    .eq('facility_id', facility.id)
    .eq('wish_date', wishDate)
    .eq('status', 'validated');

  if (ordErr) {
    console.error('Double-order check error:', ordErr);
    return error(500, 'Double-order check failed');
  }

  const alreadyValidated = (existingOrders || []).reduce(
    (sum, o) => sum + o.covers_requested, 0
  );

  const totalAfterThis = alreadyValidated + breakfastQty;

  if (totalAfterThis > entitled) {
    const result = {
      valid: false,
      reason: 'exceeds_entitlement',
      entitled,
      requested: breakfastQty,
      already_validated: alreadyValidated,
      remaining: Math.max(0, entitled - alreadyValidated),
      message: `${breakfastQty} breakfast(s) requested, but only ${entitled - alreadyValidated} remaining (${alreadyValidated} already validated, ${entitled} entitled).`,
    };
    await saveOrder(goOrderUuid, store.id, facility.id, matchedBooking.id, goLocation, wishDate, breakfastQty, 'rejected', 'exceeds_entitlement', order);
    return ok(result);
  }

  // ── Success ───────────────────────────────────────────────────────────────
  await saveOrder(goOrderUuid, store.id, facility.id, matchedBooking.id, goLocation, wishDate, breakfastQty, 'validated', 'booking_match', order);

  return ok({
    valid: true,
    reason: 'booking_match',
    entitled,
    requested: breakfastQty,
    already_validated: alreadyValidated,
    remaining: entitled - totalAfterThis,
    check_in: matchedBooking.check_in,
    check_out: matchedBooking.check_out,
    bookings_matched: bookings.length,
    facility_name: facility.name,
  });
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function saveOrder(goOrderUuid, storeId, facilityId, bookingId, goLocationId, wishDate, coversRequested, status, reason, rawPayload) {
  // Skip saving if no UUID (e.g. test requests without one)
  if (!goOrderUuid) return;

  try {
    await supabase
      .from('orders')
      .upsert({
        go_order_uuid: goOrderUuid,
        store_id: storeId,
        facility_id: facilityId,
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
