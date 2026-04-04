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
//   7a. If facility platform = "other" → entitled = max_capacity (no bookings needed)
//   7b. Otherwise → find confirmed bookings with breakfast_included covering the wish date
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

  // ── Determine entitled count ───────────────────────────────────────────────
  let entitled = 0;
  let matchedBooking = null;

  if (facility.platform === 'other') {
    // "Other (Max Pax)" facilities: entitled = max_capacity, no bookings needed
    if (!facility.max_capacity || facility.max_capacity <= 0) {
      return ok({
        valid: false,
        reason: 'no_capacity_set',
        entitled: 0,
        requested: breakfastQty,
        message: `Facility "${facility.name}" is a max-pax facility but has no capacity configured.`,
      });
    }
    entitled = facility.max_capacity;
  } else {
    // ── Find active bookings covering wishDate ──────────────────────────────
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

    entitled = bookings.reduce((sum, b) => sum + b.guest_count, 0);
    matchedBooking = bookings[0];
  }

  // ── Double-order check ────────────────────────────────────────────────────
  // How many covers have already been used today for this facility?
  // Count both 'validated' (pending) and 'fulfilled' (closed) orders.
  const { data: existingOrders, error: ordErr } = await supabase
    .from('orders')
    .select('covers_requested')
    .eq('facility_id', facility.id)
    .eq('wish_date', wishDate)
    .in('status', ['validated', 'fulfilled']);

  if (ordErr) {
    console.error('Double-order check error:', ordErr);
    return error(500, 'Double-order check failed');
  }

  const alreadyValidated = (existingOrders || []).reduce(
    (sum, o) => sum + o.covers_requested, 0
  );

  const totalAfterThis = alreadyValidated + breakfastQty;

  if (totalAfterThis > entitled) {
    const reason = facility.platform === 'other' ? 'exceeds_max_pax' : 'exceeds_entitlement';
    const result = {
      valid: false,
      reason,
      entitled,
      requested: breakfastQty,
      already_validated: alreadyValidated,
      remaining: Math.max(0, entitled - alreadyValidated),
      message: `${breakfastQty} breakfast(s) requested, but only ${entitled - alreadyValidated} remaining (${alreadyValidated} already validated, ${entitled} entitled).`,
    };
    await saveOrder(goOrderUuid, store.id, facility.id, matchedBooking?.id || null, goLocation, wishDate, breakfastQty, 'rejected', reason, order);
    return ok(result);
  }

  // ── Success ───────────────────────────────────────────────────────────────
  const successReason = facility.platform === 'other' ? 'max_pax_match' : 'booking_match';
  await saveOrder(goOrderUuid, store.id, facility.id, matchedBooking?.id || null, goLocation, wishDate, breakfastQty, 'validated', successReason, order);

  const response = {
    valid: true,
    reason: successReason,
    entitled,
    requested: breakfastQty,
    already_validated: alreadyValidated,
    remaining: entitled - totalAfterThis,
    facility_name: facility.name,
  };

  // Add booking details only for non-"other" facilities
  if (matchedBooking) {
    response.check_in = matchedBooking.check_in;
    response.check_out = matchedBooking.check_out;
    response.bookings_matched = 1;
  }

  return ok(response);
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
