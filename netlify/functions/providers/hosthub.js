// providers/hosthub.js
// HostHub (formerly app.hosthub.com) integration.
// Auth: raw API key from the linked store (no scheme prefix).
// Sync uses GET /rentals/{platform_id}/calendar-events to enumerate bookings.
// Listings uses GET /rentals to enumerate rentals on the account.
//
// Breakfast detection:
//   HostHub bookings carry a free-text `meal_plan` field that the host fills
//   in. We use a per-store keyword allowlist (substring, case-insensitive).
//   Empty allowlist → backwards-compat 'all bookings include breakfast'.

import {
  upsertBookings,
  startLog,
  endLog,
  markRoomSynced,
  offsetDate,
} from './_shared.js';

const BASE_URL = 'https://app.hosthub.com/api/2019-03-01';

// ─── Sync ────────────────────────────────────────────────────────────────────
export async function syncHostHub(room, { lookbackDays }) {
  const logId    = await startLog(room.id, 'hosthub');
  const dateFrom = offsetDate(-lookbackDays);

  const apiSecret = room.stores?.api_key_secret;
  if (!apiSecret) {
    const err = 'No API key secret found on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'hosthub', error: err };
  }

  try {
    const headers = {
      Authorization: apiSecret,
      'Content-Type': 'application/json',
    };

    const url = `${BASE_URL}/rentals/${room.platform_id}/calendar-events?date_from_gt=${dateFrom}&is_visible=all`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      const summary = { url, http_status: res.status, error_body: body.slice(0, 600) };
      await endLog(logId, 'failed', {}, `HostHub API error ${res.status}: ${body}`, summary);
      return { room_id: room.id, name: room.name, provider: 'hosthub', error: `HostHub API error ${res.status}` };
    }

    const data   = await res.json();
    const events = (data.data || []).filter(e => e.type === 'Booking');
    const rawResponse = {
      url,
      http_status: res.status,
      total_events: (data.data || []).length,
      booking_events: events.length,
      sample_first_event: events[0] || null,
      response_object: data?.object,
    };

    // Breakfast detection has two knobs on the linked store:
    //  1) bypass_meal_plan_check (boolean, default true) — when true, every
    //     booking is treated as breakfast-included regardless of meal_plan
    //     text. Useful for properties whose rate plans always include
    //     breakfast and don't bother filling meal_plan consistently.
    //  2) meal_plan_breakfast_values (string[]) — substring (case-insensitive)
    //     allowlist applied only when bypass is off.
    const bypass = room.stores?.bypass_meal_plan_check !== false; // default true
    const mealPlanAllowlist = Array.isArray(room.stores?.meal_plan_breakfast_values)
      ? room.stores.meal_plan_breakfast_values.filter(s => typeof s === 'string' && s.trim().length)
      : [];

    const stats = await upsertBookings(room, 'hosthub', events, (b) => ({
      external_id:        String(b.id),
      room_code:          String(b.rental?.id || room.platform_id),
      check_in:           b.date_from,
      check_out:          b.date_to,
      guest_count:        parseInt(b.guest_number || b.guest_adults || 1, 10),
      breakfast_included: bypass
        ? true
        : matchesAnyAllowlistEntry(b.meal_plan, mealPlanAllowlist),
      status:             b.cancelled_at ? 'cancelled' : 'confirmed',
      raw_data:           b,
    }), dateFrom);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats, null, rawResponse);
    return { room_id: room.id, name: room.name, provider: 'hosthub', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message, { exception: err.message, stack: (err.stack || '').slice(0, 1000) });
    return { room_id: room.id, name: room.name, provider: 'hosthub', error: err.message };
  }
}

// ─── Listings ────────────────────────────────────────────────────────────────
export async function fetchHostHubListings(store) {
  const res = await fetch(`${BASE_URL}/rentals`, {
    headers: {
      Authorization: store.api_key_secret,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`HostHub API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const listings = (data.data || []).map(r => ({
    platform_id: String(r.id),
    name:        r.name || r.title || r.nickname || `Rental ${r.id}`,
    capacity:    r.max_capacity ?? r.accommodates ?? r.max_guests ?? null,
    platform:    'hosthub',
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: store.id, listings, platform: 'hosthub' }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Substring (case-insensitive) match — meal_plan field against an array of
// allowlist entries. Returns true if any allowlist entry is contained in the
// meal_plan string.
function matchesAnyAllowlistEntry(mealPlan, allowlist) {
  if (!mealPlan || typeof mealPlan !== 'string') return false;
  const haystack = mealPlan.toLowerCase();
  for (const entry of allowlist) {
    const needle = String(entry || '').trim().toLowerCase();
    if (!needle) continue;
    if (haystack.includes(needle)) return true;
  }
  return false;
}
