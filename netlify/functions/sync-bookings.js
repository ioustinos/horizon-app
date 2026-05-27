// sync-bookings.js
// Entry point + dispatcher for booking syncs.
//
// Scheduled: runs every 5 min (see netlify.toml). Syncs each room whose
// last_synced_at is older than the settings.sync_interval_minutes threshold.
// Can also be triggered manually: POST /api/sync-bookings
// (force-sync.js handles per-room manual triggers from the admin UI.)
//
// Provider-specific logic lives in netlify/functions/providers/*.js.
// To add a new provider:
//   1. Drop a new file in providers/ exporting `sync<Provider>(room, opts)`
//   2. Register it in PROVIDERS below
//   3. Add the platform value to the StoreForm/RoomForm UI

import { createClient } from '@supabase/supabase-js';
import { syncHostHub }     from './providers/hosthub.js';
import { syncWebHotelier } from './providers/webhotelier.js';
import { syncRoomRack }    from './providers/roomrack.js';
import { syncHotelizer }   from './providers/hotelizer.js';
import { syncLodgify }     from './providers/lodgify.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PROVIDERS = {
  hosthub:     syncHostHub,
  webhotelier: syncWebHotelier,
  roomrack:    syncRoomRack,
  hotelizer:   syncHotelizer,
  lodgify:     syncLodgify,
};

// Columns we need from the joined `stores` row for any provider.
// Listing them explicitly keeps the SELECT consistent in both the cron and
// the manual-trigger path.
const STORE_FIELDS = 'api_key_name, api_key_secret, meal_plan_breakfast_values';

export const handler = async () => {
  // Load settings
  const { data: settingsRows } = await supabase.from('settings').select('key,value');
  const cfg = Object.fromEntries((settingsRows || []).map(r => [r.key, r.value]));
  const intervalMinutes = parseInt(cfg.sync_interval_minutes || '60', 10);
  const lookbackDays    = parseInt(cfg.sync_lookback_days    || '30', 10);
  const forwardDays     = parseInt(cfg.sync_forward_days     || '90', 10);
  const cutoff          = new Date(Date.now() - intervalMinutes * 60 * 1000).toISOString();

  // Load rooms due for sync — join stores to get API credentials
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select(`*, stores(${STORE_FIELDS})`)
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

// ─── Dispatcher ─────────────────────────────────────────────────────────────
// Re-exported so force-sync.js can reuse the same routing logic.
export async function syncRoom(room, opts = { lookbackDays: 30, forwardDays: 90 }) {
  if (!room.platform_id) {
    return { room_id: room.id, name: room.name, error: 'No platform_id set — skipped' };
  }
  // If the room record doesn't have stores joined, fetch it.
  if (!room.stores) {
    const { data } = await supabase
      .from('rooms')
      .select(`*, stores(${STORE_FIELDS})`)
      .eq('id', room.id)
      .single();
    if (data) room = data;
  }

  const provider = PROVIDERS[room.platform];
  if (!provider) {
    return { room_id: room.id, name: room.name, error: `Unknown platform: ${room.platform}` };
  }
  return provider(room, opts);
}
