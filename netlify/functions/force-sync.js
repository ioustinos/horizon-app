// force-sync.js
// Manually triggers a sync for a specific room from the admin UI.
// POST /api/force-sync?room_id=<uuid>
// Always runs immediately — no interval check. That logic lives only in the cron.

import { createClient } from '@supabase/supabase-js';
import { syncRoom }  from './sync-bookings.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const room_id = event.queryStringParameters?.room_id;
  if (!room_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing room_id query parameter' }) };
  }

  // Load the room
  const { data: room, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', room_id)
    .single();

  if (error || !room) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Room not found' }) };
  }

  // Load sync settings for window sizes
  const { data: settingsRows } = await supabase.from('settings').select('key,value');
  const cfg = Object.fromEntries((settingsRows || []).map(r => [r.key, r.value]));

  const result = await syncRoom(room, {
    lookbackDays: parseInt(cfg.sync_lookback_days || '30', 10),
    forwardDays:  parseInt(cfg.sync_forward_days  || '90', 10),
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
