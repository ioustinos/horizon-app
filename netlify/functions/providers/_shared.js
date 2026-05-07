// providers/_shared.js
// Shared infrastructure used by every provider:
//   - the supabase client
//   - the upsert/diff/delete pipeline (`upsertBookings`)
//   - sync-log lifecycle helpers (startLog / endLog)
//   - markRoomSynced
//   - small date helpers
//
// Underscore-prefixed filename signals "internal helper, not a provider".
// File lives under netlify/functions/providers/ which Netlify treats as
// regular ES modules (NOT exposed as functions, since their parent dir
// name doesn't match any filename).

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Upsert pipeline ─────────────────────────────────────────────────────────
//
// Insert new bookings, update changed ones, delete the ones that fell out of
// the API response within the sync window. A 30-day floor is enforced on
// check_in dates regardless of provider.
export async function upsertBookings(room, provider, rawBookings, transform, syncFrom) {
  let rows = rawBookings.map((b) => ({
    room_id:        room.id,
    provider,
    go_location_id: room.id,  // store our room ID for reference
    last_synced_at: new Date().toISOString(),
    ...transform(b),
  }));

  // Hard 30-day floor on check_in: defense-in-depth on top of lookbackDays.
  const cutoff30 = (() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const beforeFloor = rows.length;
  rows = rows.filter(r => r.check_in && r.check_in >= cutoff30);
  const skippedOld = beforeFloor - rows.length;

  const { data: existing } = await supabase
    .from('bookings')
    .select('external_id, check_in, check_out, guest_count, status, breakfast_included')
    .eq('room_id', room.id)
    .eq('provider', provider);

  const existingMap = new Map((existing || []).map(r => [r.external_id, r]));

  const COMPARE_FIELDS = ['check_in', 'check_out', 'guest_count', 'status', 'breakfast_included'];
  const hasChanged = (incoming, existingRow) =>
    COMPARE_FIELDS.some(f => String(incoming[f] ?? '') !== String(existingRow[f] ?? ''));

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

  // Delete bookings that fell out of the API response within our sync window.
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

  return { fetched: rawBookings.length, inserted, updated, deleted, skipped_old: skippedOld };
}

// ─── Sync-log lifecycle ──────────────────────────────────────────────────────
export async function startLog(room_id, provider) {
  const { data } = await supabase
    .from('sync_logs')
    .insert({ room_id, provider, status: 'running' })
    .select('id')
    .single();
  return data?.id;
}

export async function endLog(logId, status, stats = {}, error_message = null, raw_response = null) {
  if (!logId) return;
  await supabase.from('sync_logs').update({
    status,
    completed_at:      new Date().toISOString(),
    bookings_fetched:  stats.fetched  || 0,
    bookings_inserted: stats.inserted || 0,
    bookings_updated:  stats.updated  || 0,
    bookings_deleted:  stats.deleted  || 0,
    error_message,
    raw_response,
  }).eq('id', logId);
}

// ─── Misc helpers ────────────────────────────────────────────────────────────
export async function markRoomSynced(roomId) {
  const now = new Date().toISOString();
  await supabase
    .from('rooms')
    .update({ last_synced_at: now, updated_at: now })
    .eq('id', roomId);
}

// `days` may be negative.
export function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
