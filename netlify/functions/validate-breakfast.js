// validate-breakfast.js
// Called by GonnaOrder before payment to validate breakfast entitlement.
//
// POST /api/validate-breakfast?store_id=<gonnaorder_store_id>
// Body: full GonnaOrder order object
//
// Validation logic:
//   1. Find the Horizon store matching gonnaorder_store_id
//   2. Find all facilities linked to that store
//   3. Extract wishTime date from the order
//   4. Count total breakfast covers (PARENT order items)
//   5. Find confirmed bookings with breakfast_included covering that date
//   6. Allow if covers ≤ total entitled guests across all facilities

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const store_id = event.queryStringParameters?.store_id;
  if (!store_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing store_id query parameter' }) };
  }

  let order;
  try {
    order = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // ── Extract date from wishTime ─────────────────────────────────────────────
  const wishTime = order.wishTime;
  if (!wishTime) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing wishTime in order' }) };
  }
  const wishDate = wishTime.split('T')[0];

  // ── Count breakfast covers ─────────────────────────────────────────────────
  const breakfastQty = (order.orderItems || [])
    .filter(item => item.hierarchyLevel === 'PARENT' || !item.hierarchyLevel)
    .reduce((sum, item) => sum + (item.quantity || 1), 0);

  if (breakfastQty === 0) {
    return ok({ valid: true, reason: 'no_items', entitled: null, requested: 0 });
  }

  // ── Find the store ─────────────────────────────────────────────────────────
  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('id, name')
    .eq('gonnaorder_store_id', store_id)
    .single();

  if (storeErr || !store) {
    return { statusCode: 404, body: JSON.stringify({ error: `Store not found: ${store_id}` }) };
  }

  // ── Find all facilities for this store ────────────────────────────────────
  const { data: facilities, error: facErr } = await supabase
    .from('facilities')
    .select('id')
    .eq('store_id', store.id);

  if (facErr || !facilities?.length) {
    return ok({
      valid: false,
      reason: 'no_facilities',
      entitled: 0,
      requested: breakfastQty,
      message: 'No facilities linked to this store.',
    });
  }

  const facilityIds = facilities.map(f => f.id);

  // ── Find active bookings covering wishDate ────────────────────────────────
  // check_in ≤ wishDate < check_out
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('guest_count, check_in, check_out, breakfast_included, facility_id')
    .in('facility_id', facilityIds)
    .eq('status', 'confirmed')
    .eq('breakfast_included', true)
    .lte('check_in', wishDate)
    .gt('check_out', wishDate);

  if (bErr) {
    console.error('Booking lookup error:', bErr);
    return { statusCode: 500, body: JSON.stringify({ error: 'Booking lookup failed' }) };
  }

  if (!bookings?.length) {
    return ok({
      valid: false,
      reason: 'no_booking_found',
      entitled: 0,
      requested: breakfastQty,
      message: `No active breakfast-included booking found for ${wishDate}.`,
    });
  }

  // Sum guest counts across all active bookings (e.g. hotel has multiple rooms occupied)
  const entitled = bookings.reduce((sum, b) => sum + b.guest_count, 0);

  if (breakfastQty > entitled) {
    return ok({
      valid: false,
      reason: 'exceeds_entitlement',
      entitled,
      requested: breakfastQty,
      message: `${breakfastQty} breakfast(s) requested but only ${entitled} guest(s) entitled across all bookings.`,
    });
  }

  const earliest = bookings.reduce((a, b) => a.check_in < b.check_in ? a : b);

  return ok({
    valid: true,
    reason: 'booking_match',
    entitled,
    requested: breakfastQty,
    check_in:  earliest.check_in,
    check_out: earliest.check_out,
    bookings_matched: bookings.length,
  });
};

const ok = (data) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
