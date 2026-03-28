// validate-breakfast.js
// Called by GonnaOrder to validate breakfast entitlement for an order.
// POST /api/validate-breakfast
// Body: { store_id, location_id, service_date, order_id?, items: [{ tag, quantity }] }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BREAKFAST_TAG = 'HORIZON_BREAKFAST';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { store_id, location_id, service_date, order_id, items = [] } = body;

  if (!store_id || !location_id || !service_date) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: store_id, location_id, service_date' }),
    };
  }

  // Count how many breakfast items are being ordered
  const breakfastQty = items
    .filter((i) => i.tag === BREAKFAST_TAG)
    .reduce((sum, i) => sum + (i.quantity || 1), 0);

  // If no breakfast items, skip validation
  if (breakfastQty === 0) {
    return ok({ valid: true, reason: 'no_breakfast_items', entitled: null, requested: 0 });
  }

  // Load store config
  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('*')
    .eq('store_id', store_id)
    .single();

  if (storeErr || !store) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Store not found' }) };
  }

  // --- Determine validation source ---
  if (store.webhotelier_enabled || store.hosthub_enabled) {
    // Look up active booking for this store + location + service date
    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select('guest_count, breakfast_included, status')
      .eq('store_id', store_id)
      .eq('go_location_id', location_id)
      .eq('status', 'confirmed')
      .eq('breakfast_included', true)
      .lte('check_in', service_date)
      .gt('check_out', service_date);

    if (bErr) {
      console.error('Booking lookup error:', bErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Booking lookup failed' }) };
    }

    if (!bookings || bookings.length === 0) {
      // Provider is enabled but no booking found — fail validation
      return ok({
        valid: false,
        reason: 'no_booking_found',
        entitled: 0,
        requested: breakfastQty,
        message: 'No active booking with breakfast found for this location and date.',
      });
    }

    // Sum guest counts across matching bookings (usually just one)
    const entitled = bookings.reduce((sum, b) => sum + b.guest_count, 0);

    if (breakfastQty > entitled) {
      return ok({
        valid: false,
        reason: 'exceeds_entitlement',
        entitled,
        requested: breakfastQty,
        message: `Breakfast quantity (${breakfastQty}) exceeds booking entitlement (${entitled}).`,
      });
    }

    return ok({ valid: true, reason: 'booking_match', entitled, requested: breakfastQty });
  }

  // --- PAX fallback ---
  if (store.pax_capacity != null) {
    if (breakfastQty > store.pax_capacity) {
      return ok({
        valid: false,
        reason: 'exceeds_pax',
        entitled: store.pax_capacity,
        requested: breakfastQty,
        message: `Breakfast quantity (${breakfastQty}) exceeds location capacity (${store.pax_capacity}).`,
      });
    }
    return ok({ valid: true, reason: 'pax_fallback', entitled: store.pax_capacity, requested: breakfastQty });
  }

  // No integration, no PAX — allow
  return ok({ valid: true, reason: 'no_validation_required', entitled: null, requested: breakfastQty });
};

const ok = (data) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
