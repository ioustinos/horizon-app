// force-sync.js
// Manually triggers a sync for a specific facility from the admin UI.
// POST /api/force-sync?facility_id=<uuid>
// Called by the admin panel with the user's Supabase JWT in Authorization header.

import { createClient } from '@supabase/supabase-js';
import { syncFacility }  from './sync-bookings.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify the caller is an authenticated Supabase user
  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const supabaseUser = createClient(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || '');
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  const facility_id = event.queryStringParameters?.facility_id;
  if (!facility_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing facility_id query parameter' }) };
  }

  // Load the facility
  const { data: facility, error } = await supabase
    .from('facilities')
    .select('*')
    .eq('id', facility_id)
    .single();

  if (error || !facility) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Facility not found' }) };
  }

  // Load sync settings
  const { data: settingsRows } = await supabase.from('settings').select('key,value');
  const cfg = Object.fromEntries((settingsRows || []).map(r => [r.key, r.value]));

  const result = await syncFacility(facility, {
    lookbackDays: parseInt(cfg.sync_lookback_days || '30', 10),
    forwardDays:  parseInt(cfg.sync_forward_days  || '90', 10),
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
