// sync-bookings.js
// Scheduled job: syncs bookings from WebHotelier and/or HostHub for all enabled stores.
// Can also be triggered manually via POST /api/sync-bookings?store_id=xxx

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  const targetStoreId = event.queryStringParameters?.store_id || null;

  // Load all enabled stores (or a specific one)
  let query = supabase
    .from('stores')
    .select('*')
    .or('webhotelier_enabled.eq.true,hosthub_enabled.eq.true');

  if (targetStoreId) query = query.eq('store_id', targetStoreId);

  const { data: stores, error } = await query;
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

  const results = [];
  for (const store of stores) {
    if (store.webhotelier_enabled) {
      results.push(await syncWebHotelier(store));
    }
    if (store.hosthub_enabled) {
      results.push(await syncHostHub(store));
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ synced: results.length, results }),
  };
};

// ─── WebHotelier ───────────────────────────────────────────────────────────────
async function syncWebHotelier(store) {
  const logId = await startLog(store.store_id, 'webhotelier');
  const dateFrom = offsetDate(-store.sync_days_lookback);
  const dateTo   = offsetDate(store.sync_days_forward);

  try {
    const baseUrl = 'https://api.webhotelier.net/v1';
    const headers = {
      Authorization: `Bearer ${store.webhotelier_api_key}`,
      'Content-Type': 'application/json',
    };

    // Fetch all bookings in the window
    const res = await fetch(
      `${baseUrl}/bookings?property=${store.webhotelier_property_code}&arrival_from=${dateFrom}&arrival_to=${dateTo}&limit=500`,
      { headers }
    );

    if (!res.ok) throw new Error(`WebHotelier API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const bookings = data.bookings || data.data || [];

    const stats = await upsertBookings(store, 'webhotelier', bookings, (b) => ({
      external_id:        String(b.id || b.booking_id),
      room_code:          String(b.room_code || b.room?.code || ''),
      check_in:           b.arrival || b.check_in,
      check_out:          b.departure || b.check_out,
      guest_count:        b.adults + (b.children || 0) || 1,
      breakfast_included: (store.webhotelier_breakfast_board_ids || []).includes(String(b.board_id || '')),
      status:             b.status === 'cancelled' ? 'cancelled' : 'confirmed',
      raw_data:           b,
    }));

    await endLog(logId, 'success', stats);
    return { store: store.store_id, provider: 'webhotelier', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { store: store.store_id, provider: 'webhotelier', error: err.message };
  }
}

// ─── HostHub ───────────────────────────────────────────────────────────────────
async function syncHostHub(store) {
  const logId = await startLog(store.store_id, 'hosthub');
  const dateFrom = offsetDate(-store.sync_days_lookback);
  const dateTo   = offsetDate(store.sync_days_forward);
  const baseUrl  = store.hosthub_environment === 'production'
    ? 'https://app.hosthub.com/api/2019-03-01'
    : 'https://eric.hosthub.com/api/2019-03-01';

  try {
    const headers = {
      Authorization: `Bearer ${store.hosthub_api_key}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(
      `${baseUrl}/bookings?date_from_gt=${dateFrom}&date_from_lt=${dateTo}&per_page=500`,
      { headers }
    );

    if (!res.ok) throw new Error(`HostHub API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const bookings = data.data || data.bookings || [];

    const stats = await upsertBookings(store, 'hosthub', bookings, (b) => ({
      external_id:        String(b.id),
      room_code:          String(b.rental_id || b.rental?.id || ''),
      check_in:           b.date_from || b.check_in,
      check_out:          b.date_to || b.check_out,
      guest_count:        b.guests || b.guest_count || 1,
      breakfast_included: true, // HostHub: presence = breakfast included
      status:             b.status === 'cancelled' ? 'cancelled' : 'confirmed',
      raw_data:           b,
    }));

    await endLog(logId, 'success', stats);
    return { store: store.store_id, provider: 'hosthub', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { store: store.store_id, provider: 'hosthub', error: err.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function upsertBookings(store, provider, rawBookings, transform) {
  // Load room mappings for this store
  const { data: mappings } = await supabase
    .from('room_mappings')
    .select('*')
    .eq('store_id', store.store_id);

  const mappingByRoomCode = {};
  (mappings || []).forEach((m) => {
    const key = provider === 'webhotelier' ? m.webhotelier_room_code : m.hosthub_rental_id;
    if (key) mappingByRoomCode[key] = m.go_location_id;
  });

  let inserted = 0, updated = 0;
  const rows = rawBookings.map((b) => {
    const t = transform(b);
    return {
      store_id:          store.store_id,
      provider,
      go_location_id:    mappingByRoomCode[t.room_code] || null,
      last_synced_at:    new Date().toISOString(),
      ...t,
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from('bookings')
      .upsert(rows, { onConflict: 'store_id,provider,external_id', ignoreDuplicates: false });
    if (error) throw new Error(`Upsert error: ${error.message}`);
    inserted = rows.filter((r) => r.status === 'confirmed').length;
    updated  = rows.length - inserted;
  }

  return { fetched: rawBookings.length, inserted, updated, deleted: 0 };
}

async function startLog(store_id, provider) {
  const { data } = await supabase
    .from('sync_logs')
    .insert({ store_id, provider, status: 'running' })
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
