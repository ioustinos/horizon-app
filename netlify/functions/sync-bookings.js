// sync-bookings.js
// Scheduled: runs every 5 min. Syncs each facility whose last_synced_at
// is older than the settings.sync_interval_minutes threshold.
// Can also be triggered manually: POST /api/sync-bookings
// (force-sync.js handles per-facility manual triggers from the admin UI)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async () => {
  // Load settings
  const { data: settingsRows } = await supabase.from('settings').select('key,value');
  const cfg = Object.fromEntries((settingsRows || []).map(r => [r.key, r.value]));
  const intervalMinutes  = parseInt(cfg.sync_interval_minutes || '60', 10);
  const lookbackDays     = parseInt(cfg.sync_lookback_days    || '30', 10);
  const forwardDays      = parseInt(cfg.sync_forward_days     || '90', 10);
  const cutoff           = new Date(Date.now() - intervalMinutes * 60 * 1000).toISOString();

  // Load facilities due for sync (never synced, or synced before cutoff)
  const { data: facilities, error } = await supabase
    .from('facilities')
    .select('*')
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);

  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

  const results = [];
  for (const facility of (facilities || [])) {
    const result = await syncFacility(facility, { lookbackDays, forwardDays });
    results.push(result);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ synced: results.length, results }),
  };
};

// ─── Dispatcher ───────────────────────────────────────────────────────────────
export async function syncFacility(facility, opts = { lookbackDays: 30, forwardDays: 90 }) {
  if (!facility.external_id) {
    return { facility_id: facility.id, name: facility.name, error: 'No external_id set — skipped' };
  }
  if (facility.platform === 'hosthub') return syncHostHub(facility, opts);
  if (facility.platform === 'webhotelier') return syncWebHotelier(facility, opts);
  return { facility_id: facility.id, name: facility.name, error: `Unknown platform: ${facility.platform}` };
}

// ─── HostHub ──────────────────────────────────────────────────────────────────
// Auth: Authorization: apiKey <key>
// Endpoint: GET /rentals/{external_id}/calendar-events
// The external_id on the facility IS the rental ID (e.g. 3gt8cnskey from the URL)
async function syncHostHub(facility, { lookbackDays }) {
  const logId    = await startLog(facility.id, 'hosthub');
  const dateFrom = offsetDate(-lookbackDays);
  const baseUrl  = 'https://eric.hosthub.com/api/2019-03-01';

  try {
    // HostHub auth: raw API key value, no prefix (per HostHub OpenAPI spec)
    const headers = {
      Authorization: facility.api_key_secret,
      'Content-Type': 'application/json',
    };

    const res = await fetch(
      `${baseUrl}/rentals/${facility.external_id}/calendar-events?date_from_gt=${dateFrom}&is_visible=all`,
      { headers }
    );
    if (!res.ok) throw new Error(`HostHub API error ${res.status}: ${await res.text()}`);

    const data   = await res.json();
    const events = (data.data || []).filter(e => e.type === 'Booking');

    const stats = await upsertBookings(facility, 'hosthub', events, (b) => ({
      external_id:        String(b.id),
      room_code:          String(b.rental?.id || facility.external_id),
      check_in:           b.date_from,
      check_out:          b.date_to,
      guest_count:        parseInt(b.guest_number || b.guest_adults || 1, 10),
      breakfast_included: true, // Airbnb/HostHub: all bookings include breakfast
      status:             b.cancelled_at ? 'cancelled' : 'confirmed',
      raw_data:           b,
    }));

    await markFacilitySynced(facility.id);
    await endLog(logId, 'success', stats);
    return { facility_id: facility.id, name: facility.name, provider: 'hosthub', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { facility_id: facility.id, name: facility.name, provider: 'hosthub', error: err.message };
  }
}

// ─── WebHotelier ──────────────────────────────────────────────────────────────
// Auth: Authorization: Bearer <api_key_secret>
// external_id = WebHotelier property code
async function syncWebHotelier(facility, { lookbackDays, forwardDays }) {
  const logId    = await startLog(facility.id, 'webhotelier');
  const dateFrom = offsetDate(-lookbackDays);
  const dateTo   = offsetDate(forwardDays);

  try {
    const headers = {
      Authorization: `Bearer ${facility.api_key_secret}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(
      `https://api.webhotelier.net/v1/bookings?property=${facility.external_id}&arrival_from=${dateFrom}&arrival_to=${dateTo}&limit=500`,
      { headers }
    );
    if (!res.ok) throw new Error(`WebHotelier API error ${res.status}: ${await res.text()}`);

    const data     = await res.json();
    const bookings = data.bookings || data.data || [];

    const stats = await upsertBookings(facility, 'webhotelier', bookings, (b) => ({
      external_id:        String(b.id || b.booking_id),
      room_code:          String(b.room_code || b.room?.code || ''),
      check_in:           b.arrival || b.check_in,
      check_out:          b.departure || b.check_out,
      guest_count:        (b.adults || 0) + (b.children || 0) || 1,
      breakfast_included: false, // WebHotelier: set per board_id config (future)
      status:             b.status === 'cancelled' ? 'cancelled' : 'confirmed',
      raw_data:           b,
    }));

    await markFacilitySynced(facility.id);
    await endLog(logId, 'success', stats);
    return { facility_id: facility.id, name: facility.name, provider: 'webhotelier', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { facility_id: facility.id, name: facility.name, provider: 'webhotelier', error: err.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function upsertBookings(facility, provider, rawBookings, transform) {
  const rows = rawBookings.map((b) => ({
    facility_id:    facility.id,
    provider,
    go_location_id: facility.location_room_id || null,
    last_synced_at: new Date().toISOString(),
    ...transform(b),
  }));

  if (rows.length === 0) {
    return { fetched: 0, inserted: 0, updated: 0, deleted: 0 };
  }

  // Fetch existing external_ids for this facility+provider so we can
  // distinguish genuine inserts from updates after the upsert.
  const { data: existing } = await supabase
    .from('bookings')
    .select('external_id')
    .eq('facility_id', facility.id)
    .eq('provider', provider);

  const existingIds = new Set((existing || []).map(r => r.external_id));

  const { error } = await supabase
    .from('bookings')
    .upsert(rows, { onConflict: 'facility_id,provider,external_id', ignoreDuplicates: false });
  if (error) throw new Error(`Upsert error: ${error.message}`);

  const inserted = rows.filter(r => !existingIds.has(r.external_id)).length;
  const updated  = rows.filter(r =>  existingIds.has(r.external_id)).length;

  return { fetched: rawBookings.length, inserted, updated, deleted: 0 };
}

async function markFacilitySynced(facilityId) {
  const now = new Date().toISOString();
  await supabase
    .from('facilities')
    .update({ last_synced_at: now, updated_at: now })
    .eq('id', facilityId);
}

async function startLog(facility_id, provider) {
  const { data } = await supabase
    .from('sync_logs')
    .insert({ facility_id, provider, status: 'running' })
    .select('id')
    .single();
  return data?.id;
}

async function endLog(logId, status, stats = {}, error_message = null) {
  if (!logId) return;
  await supabase.from('sync_logs').update({
    status,
    completed_at:      new Date().toISOString(),
    bookings_fetched:  stats.fetched  || 0,
    bookings_inserted: stats.inserted || 0,
    bookings_updated:  stats.updated  || 0,
    bookings_deleted:  stats.deleted  || 0,
    error_message,
  }).eq('id', logId);
}

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
