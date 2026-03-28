// validate-breakfast.js
// Called by GonnaOrder before payment to validate breakfast entitlement.
//
// GonnaOrder webhook URL: POST /api/validate-breakfast?store_id=<store_id>
// Body: full GonnaOrder order object
//
// Validation logic:
//   1. Extract wishTime date from the order
//   2. Count total breakfast covers (sum of quantity for PARENT order items)
//   3. Find a confirmed booking covering that date for the store
//   4. Allow if covers ≤ booking guest_count, deny otherwise

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // store_id comes from the webhook URL query param configured in GonnaOrder
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

  // ── Extract date from wishTime ────────────────────────────────────────────
  const wishTime = order.wishTime;
  if (!wishTime) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing wishTime in order' }) };
  }
  const wishDate = wishTime.split('T')[0]; // e.g. "2026-04-10"

  // ── Count breakfast covers ────────────────────────────────────────────────
  // Each PARENT item = one breakfast cover (CHILD items are modifiers/options)
  const breakfastQty = (order.orderItems || [])
    .filter(item => item.hierarchyLevel === 'PARENT' || !item.hierarchyLevel)
    .reduce((sum, item) => sum + (item.quantity || 1), 0);

  if (breakfastQty === 0) {
    return ok({ valid: true, reason: 'no_items', entitled: null, requested: 0 });
  }

  // ── Find active booking covering wishDate ─────────────────────────────────
  // check_in ≤ wishDate < check_out  (check_out is the departure day, not a stay night)
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('guest_count, check_in, check_out, status, breakfast_included')
    .eq('store_id', store_id)
    .eq('status', 'confirmed')
    .lte('check_in', wishDate)
    .gt('check_out', wishDate);

  if (bErr) {
    console.error('Booking lookup error:', bErr);
    return { statusCode: 500, body: JSON.stringify({ error: 'Booking lookup failed' }) };
  }

  if (!bookings || bookings.length === 0) {
    return ok({
      valid: false,
      reason: 'no_booking_found',
      entitled: 0,
      requested: breakfastQty,
      message: `No active booking found for ${wishDate}. Breakfast is not available.`,
    });
  }

  // If multiple bookings cover the date (edge case), use the one with highest guest count
  const booking = bookings.reduce((best, b) =>
    b.guest_count > best.guest_count ? b : best
  );

  const entitled = booking.guest_count;

  if (breakfastQty > entitled) {
    return ok({
      valid: false,
      reason: 'exceeds_entitlement',
      entitled,
      requested: breakfastQty,
      message: `${breakfastQty} breakfast(s) requested but booking only covers ${entitled} guest(s).`,
    });
  }

  return ok({
    valid: true,
    reason: 'booking_match',
    entitled,
    requested: breakfastQty,
    check_in: booking.check_in,
    check_out: booking.check_out,
  });
};

const ok = (data) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
