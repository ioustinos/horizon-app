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

  // Load facilities due for sync — join stores to get API credentials
  const { data: facilities, error } = await supabase
    .from('facilities')
    .select('*, stores(api_key_name, api_key_secret)')
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
  // If the facility record doesn't have stores joined, fetch it
  if (!facility.stores) {
    const { data } = await supabase
      .from('facilities')
      .select('*, stores(api_key_name, api_key_secret)')
      .eq('id', facility.id)
      .single();
    if (data) facility = data;
  }
  if (facility.platform === 'hosthub')     return syncHostHub(facility, opts);
  if (facility.platform === 'webhotelier') return syncWebHotelier(facility, opts);
  return { facility_id: facility.id, name: facility.name, error: `Unknown platform: ${facility.platform}` };
}

// ─── HostHub ──────────────────────────────────────────────────────────────────
// Auth: raw API key from the linked store, no prefix
// Endpoint: GET /rentals/{external_id}/calendar-events
async function syncHostHub(facility, { lookbackDays }) {
  const logId    = await startLog(facility.id, 'hosthub');
  const dateFrom = offsetDate(-lookbackDays);
  const baseUrl  = 'https://eric.hosthub.com/api/2019-03-01';

  const apiSecret = facility.stores?.api_key_secret;
  if (!apiSecret) {
    const err = 'No API key secret found on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { facility_id: facility.id, name: facility.name, provider: 'hosthub', error: err };
  }

  try {
    const headers = {
      Authorization: apiSecret,
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
    }), dateFrom);

    await markFacilitySynced(facility.id);
    await endLog(logId, 'success', stats);
    return { facility_id: facility.id, name: facility.name, provider: 'hosthub', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { facility_id: facility.id, name: facility.name, provider: 'hosthub', error: err.message };
  }
}

// ─── WebHotelier ──────────────────────────────────────────────────────────────
// Auth: HTTP Basic (api_key_name:api_key_secret from linked store)
// api_key_name = property code / username (e.g. HRZNTEST)
// Base URL: https://rest.reserve-online.net
// Booking Search: GET /reservation?chkin_fromd=...&chkin_tod=...&verbose=2&maxrows=1000
// external_id on facility = room code (e.g. DBL, TRP) — used to filter bookings for this room
//
// Board IDs that include breakfast (OpenTravel standard):
// 1=All inclusive, 2=American, 3=B&B, 4=Buffet breakfast, 5=Caribbean breakfast,
// 6=Continental, 7=English, 10=Full board, 11=Full breakfast, 12=Half board,
// 17=Dinner B&B, 18=Family American, 19=Breakfast, 23=Breakfast & lunch
const BREAKFAST_BOARD_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 17, 18, 19, 23]);

async function syncWebHotelier(facility, { lookbackDays, forwardDays }) {
  const logId    = await startLog(facility.id, 'webhotelier');
  const dateFrom = offsetDate(-lookbackDays);
  const dateTo   = offsetDate(forwardDays);

  const apiName   = facility.stores?.api_key_name;
  const apiSecret = facility.stores?.api_key_secret;
  if (!apiSecret || !apiName) {
    const err = 'No API credentials (username + password) found on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { facility_id: facility.id, name: facility.name, provider: 'webhotelier', error: err };
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(`${apiName}:${apiSecret}`).toString('base64');
    const headers = {
      Authorization: authHeader,
      Accept: 'application/json',
    };

    // Use /reservation endpoint with check-in date range filter and verbose=2 for full details
    const res = await fetch(
      `https://rest.reserve-online.net/reservation?chkin_fromd=${dateFrom}&chkin_tod=${dateTo}&verbose=2&maxrows=1000`,
      { headers }
    );
    if (!res.ok) throw new Error(`WebHotelier API error ${res.status}: ${await res.text()}`);

    const text = await res.text();
    if (!text || !text.trim()) throw new Error('WebHotelier API returned empty response');
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`WebHotelier API returned invalid JSON (${text.length} chars): ${parseErr.message}`);
    }
    // API response: { data: { reservations: [...] } } or { data: [ ... ] }
    let allBookings = data?.data?.reservations || data?.data?.bookings ||
      (Array.isArray(data?.data) ? data.data : []);

    // If this facility has an external_id (room code), filter bookings to that room type
    // Actual API shape: roomStay is an OBJECT (not array) with camelCase fields:
    //   roomStay: { roomType: "DBL", roomName: "Double Room", boardID: null, from: "2026-04-04", to: "2026-04-05", ... }
    //   rooms: [{ roomNo: 1, adults: 2, children: 0, infants: 0, rates: [...] }]
    const roomCode = facility.external_id;
    let bookings = allBookings;
    if (roomCode) {
      bookings = allBookings.filter(b => {
        const bRoom = b.roomStay?.roomType || '';
        return String(bRoom) === String(roomCode);
      });
    }

    const stats = await upsertBookings(facility, 'webhotelier', bookings, (b) => {
      const stay = b.roomStay || {};
      // Guest count from rooms[] array (first room entry has adults/children/infants)
      const room0    = b.rooms?.[0] || {};
      const adults   = parseInt(room0.adults ?? 1, 10);
      const children = parseInt(room0.children ?? 0, 10);
      const infants  = parseInt(room0.infants ?? 0, 10);
      const guests   = adults + children; // infants typically don't count for breakfast

      // Status: status=1 confirmed, status=0 cancelled; statusCode is string
      const statusCode = (b.statusCode || '').toUpperCase();
      let status = 'confirmed';
      if (statusCode === 'CANCELLED' || statusCode === 'PURGED' || b.status === 0 || b.status === '0') {
        status = 'cancelled';
      }

      // Breakfast: check board/boardID from roomStay (OpenTravel numeric codes)
      // API returns "board" (not "boardID") — null when no meal plan is configured
      const boardId = parseInt(stay.board ?? stay.boardID ?? -1, 10);
      const breakfast_included = BREAKFAST_BOARD_IDS.has(boardId);

      return {
        external_id:        String(b.id || ''),
        room_code:          String(stay.roomType || roomCode || ''),
        check_in:           stay.from || '',
        check_out:          stay.to || '',
        guest_count:        guests,
        breakfast_included,
        status,
        raw_data:           b,
      };
    }, dateFrom);

    await markFacilitySynced(facility.id);
    await endLog(logId, 'success', stats);
    return { facility_id: facility.id, name: facility.name, provider: 'webhotelier', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { facility_id: facility.id, name: facility.name, provider: 'webhotelier', error: err.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// upsertBookings
// - Inserts new bookings, updates changed ones
// - Deletes bookings that exist in DB but were NOT returned by the API,
//   scoped to check_in >= syncFrom (within our sync window only)
async function upsertBookings(facility, provider, rawBookings, transform, syncFrom) {
  const rows = rawBookings.map((b) => ({
    facility_id:    facility.id,
    provider,
    go_location_id: facility.location_room_id || null,
    last_synced_at: new Date().toISOString(),
    ...transform(b),
  }));

  // Fetch all existing bookings for this facility+provider
  const { data: existing } = await supabase
    .from('bookings')
    .select('external_id, check_in, check_out, guest_count, status, breakfast_included')
    .eq('facility_id', facility.id)
    .eq('provider', provider);

  const existingMap = new Map((existing || []).map(r => [r.external_id, r]));

  const COMPARE_FIELDS = ['check_in', 'check_out', 'guest_count', 'status', 'breakfast_included'];
  const hasChanged = (incoming, existing) =>
    COMPARE_FIELDS.some(f => String(incoming[f] ?? '') !== String(existing[f] ?? ''));

  const fetchedIds = new Set(rows.map(r => r.external_id));

  // Count inserts and real updates before touching the DB
  const inserted = rows.filter(r => !existingMap.has(r.external_id)).length;
  const updated  = rows.filter(r =>
    existingMap.has(r.external_id) && hasChanged(r, existingMap.get(r.external_id))
  ).length;

  // Upsert fetched bookings
  if (rows.length > 0) {
    const { error } = await supabase
      .from('bookings')
      .upsert(rows, { onConflict: 'facility_id,provider,external_id', ignoreDuplicates: false });
    if (error) throw new Error(`Upsert error: ${error.message}`);
  }

  // Delete bookings that were not returned by the API but fall within our
  // sync window (check_in >= syncFrom). Bookings outside the window are left alone.
  let deleted = 0;
  const staleIds = [...existingMap.keys()].filter(id => {
    if (fetchedIds.has(id)) return false;
    if (!syncFrom) return false;
    const rec = existingMap.get(id);
    return rec.check_in && new Date(rec.check_in) >= new Date(syncFrom);
  });

  if (staleIds.length > 0) {
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('facility_id', facility.id)
      .eq('provider', provider)
      .in('external_id', staleIds);
    if (!error) deleted = staleIds.length;
  }

  return { fetched: rawBookings.length, inserted, updated, deleted };
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
