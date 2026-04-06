// sync-bookings.js
// Scheduled: runs every 5 min. Syncs each room whose last_synced_at
// is older than the settings.sync_interval_minutes threshold.
// Can also be triggered manually: POST /api/sync-bookings
// (force-sync.js handles per-room manual triggers from the admin UI)

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

  // Load rooms due for sync — join stores to get API credentials
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('*, stores(api_key_name, api_key_secret)')
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);

  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

  const results = [];
  for (const room of (rooms || [])) {
    const result = await syncRoom(room, { lookbackDays, forwardDays });
    results.push(result);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ synced: results.length, results }),
  };
};

// ─── Dispatcher ───────────────────────────────────────────────────────────────
export async function syncRoom(room, opts = { lookbackDays: 30, forwardDays: 90 }) {
  if (!room.platform_id) {
    return { room_id: room.id, name: room.name, error: 'No platform_id set — skipped' };
  }
  // If the room record doesn't have stores joined, fetch it
  if (!room.stores) {
    const { data } = await supabase
      .from('rooms')
      .select('*, stores(api_key_name, api_key_secret)')
      .eq('id', room.id)
      .single();
    if (data) room = data;
  }
  if (room.platform === 'hosthub')     return syncHostHub(room, opts);
  if (room.platform === 'webhotelier') return syncWebHotelier(room, opts);
  return { room_id: room.id, name: room.name, error: `Unknown platform: ${room.platform}` };
}

// ─── HostHub ──────────────────────────────────────────────────────────────────
// Auth: raw API key from the linked store, no prefix
// Endpoint: GET /rentals/{platform_id}/calendar-events
async function syncHostHub(room, { lookbackDays }) {
  const logId    = await startLog(room.id, 'hosthub');
  const dateFrom = offsetDate(-lookbackDays);
  const baseUrl  = 'https://eric.hosthub.com/api/2019-03-01';

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

    const res = await fetch(
      `${baseUrl}/rentals/${room.platform_id}/calendar-events?date_from_gt=${dateFrom}&is_visible=all`,
      { headers }
    );
    if (!res.ok) throw new Error(`HostHub API error ${res.status}: ${await res.text()}`);

    const data   = await res.json();
    const events = (data.data || []).filter(e => e.type === 'Booking');

    const stats = await upsertBookings(room, 'hosthub', events, (b) => ({
      external_id:        String(b.id),
      room_code:          String(b.rental?.id || room.platform_id),
      check_in:           b.date_from,
      check_out:          b.date_to,
      guest_count:        parseInt(b.guest_number || b.guest_adults || 1, 10),
      breakfast_included: true, // Airbnb/HostHub: all bookings include breakfast
      status:             b.cancelled_at ? 'cancelled' : 'confirmed',
      raw_data:           b,
    }), dateFrom);

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'hosthub', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'hosthub', error: err.message };
  }
}

// ─── WebHotelier ──────────────────────────────────────────────────────────────
// Auth: HTTP Basic (api_key_name:api_key_secret from linked store)
// api_key_name = property code / username (e.g. HRZNTEST)
// Base URL: https://rest.reserve-online.net
// Booking Search: GET /reservation?chkin_fromd=...&chkin_tod=...&verbose=2&maxrows=1000
// platform_id on room = room code (e.g. DBL, TRP) — used to filter bookings for this room
//
// Board IDs that include breakfast (OpenTravel standard):
// 1=All inclusive, 2=American, 3=B&B, 4=Buffet breakfast, 5=Caribbean breakfast,
// 6=Continental, 7=English, 10=Full board, 11=Full breakfast, 12=Half board,
// 17=Dinner B&B, 18=Family American, 19=Breakfast, 23=Breakfast & lunch
const BREAKFAST_BOARD_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 17, 18, 19, 23]);

async function syncWebHotelier(room, { lookbackDays, forwardDays }) {
  const logId    = await startLog(room.id, 'webhotelier');
  const dateFrom = offsetDate(-lookbackDays);
  const dateTo   = offsetDate(forwardDays);

  const apiName   = room.stores?.api_key_name;
  const apiSecret = room.stores?.api_key_secret;
  if (!apiSecret || !apiName) {
    const err = 'No API credentials (username + password) found on linked store — skipped';
    await endLog(logId, 'failed', {}, err);
    return { room_id: room.id, name: room.name, provider: 'webhotelier', error: err };
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(`${apiName}:${apiSecret}`).toString('base64');
    const headers = {
      Authorization: authHeader,
      Accept: 'application/json',
    };

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
    let allBookings = data?.data?.reservations || data?.data?.bookings ||
      (Array.isArray(data?.data) ? data.data : []);

    // If this room has a platform_id (room code), filter bookings to that room type
    const roomCode = room.platform_id;
    let bookings = allBookings;
    if (roomCode) {
      bookings = allBookings.filter(b => {
        const bRoom = b.roomStay?.roomType || '';
        return String(bRoom) === String(roomCode);
      });
    }

    const stats = await upsertBookings(room, 'webhotelier', bookings, (b) => {
      const stay = b.roomStay || {};
      const room0    = b.rooms?.[0] || {};
      const adults   = parseInt(room0.adults ?? 1, 10);
      const children = parseInt(room0.children ?? 0, 10);
      const guests   = adults + children;

      const statusCode = (b.statusCode || '').toUpperCase();
      let status = 'confirmed';
      if (statusCode === 'CANCELLED' || statusCode === 'PURGED' || b.status === 0 || b.status === '0') {
        status = 'cancelled';
      }

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

    await markRoomSynced(room.id);
    await endLog(logId, 'success', stats);
    return { room_id: room.id, name: room.name, provider: 'webhotelier', ...stats };
  } catch (err) {
    await endLog(logId, 'failed', {}, err.message);
    return { room_id: room.id, name: room.name, provider: 'webhotelier', error: err.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertBookings(room, provider, rawBookings, transform, syncFrom) {
  const rows = rawBookings.map((b) => ({
    room_id:        room.id,
    provider,
    go_location_id: room.id,  // store our room ID for reference
    last_synced_at: new Date().toISOString(),
    ...transform(b),
  }));

  const { data: existing } = await supabase
    .from('bookings')
    .select('external_id, check_in, check_out, guest_count, status, breakfast_included')
    .eq('room_id', room.id)
    .eq('provider', provider);

  const existingMap = new Map((existing || []).map(r => [r.external_id, r]));

  const COMPARE_FIELDS = ['check_in', 'check_out', 'guest_count', 'status', 'breakfast_included'];
  const hasChanged = (incoming, existing) =>
    COMPARE_FIELDS.some(f => String(incoming[f] ?? '') !== String(existing[f] ?? ''));

  const fetchedIds = new Set(rows.map(r => r.external_id));

  const inserted = rows.filter(r => !existingMap.has(r.external_id)).length;
  const updated  = rows.filter(r =>
    existingMap.has(r.external_id) && hasChanged(r, existingMap.get(r.external_id))
  ).length;

  if (rows.length > 0) {
    const { error } = await supabase
      .from('bookings')
      .upsert(rows, { onConflict: 'room_id,provider,external_id', ignoreDuplicates: false });
    if (error) throw new Error(`Upsert error: ${error.message}`);
  }

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
      .eq('room_id', room.id)
      .eq('provider', provider)
      .in('external_id', staleIds);
    if (!error) deleted = staleIds.length;
  }

  return { fetched: rawBookings.length, inserted, updated, deleted };
}

async function markRoomSynced(roomId) {
  const now = new Date().toISOString();
  await supabase
    .from('rooms')
    .update({ last_synced_at: now, updated_at: now })
    .eq('id', roomId);
}

async function startLog(room_id, provider) {
  const { data } = await supabase
    .from('sync_logs')
    .insert({ room_id, provider, status: 'running' })
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
