// fetch-listings.js
// GET /api/fetch-listings?store_id=<uuid>
// Fetches all rental listings from the booking platform for a given store
// using the credentials stored on that store record.
// Currently supports HostHub. WebHotelier support can be added later.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const store_id = event.queryStringParameters?.store_id;
  if (!store_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'store_id query param is required' }) };
  }

  // Load store with API credentials
  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('id, name, accommodation_company, api_key_name, api_key_secret')
    .eq('id', store_id)
    .single();

  if (storeErr || !store) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Store not found' }) };
  }
  if (!store.api_key_secret) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: 'No API credentials configured for this store. Add them in the Store settings.' }),
    };
  }

  try {
    // HostHub: list all rentals for this account
    const res = await fetch('https://eric.hosthub.com/api/2019-03-01/rentals', {
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
      external_id: String(r.id),
      name:        r.name || r.title || r.nickname || `Rental ${r.id}`,
      capacity:    r.max_capacity ?? r.accommodates ?? r.max_guests ?? null,
      platform:    'hosthub',
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id, listings, platform: 'hosthub' }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
