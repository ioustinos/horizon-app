// fetch-listings.js
// GET /api/fetch-listings?store_id=<uuid>
// Fetches rental/room listings from the booking platform for a given store.
// Routes to HostHub or WebHotelier based on the store's `platform` field.

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

  // Load store with API credentials + platform
  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('id, name, accommodation_company, api_key_name, api_key_secret, platform')
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
    if (store.platform === 'webhotelier') {
      return await fetchWebHotelierListings(store);
    }
    // Default: HostHub
    return await fetchHostHubListings(store);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ─── HostHub ────────────────────────────────────────────────────────────────
async function fetchHostHubListings(store) {
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

// ─── WebHotelier ────────────────────────────────────────────────────────────
// Uses the Room Listing endpoint: GET /room/{propertycode}
// Auth: Basic (api_key_name:api_key_secret)
// api_key_name = username = property code (e.g. HRZNTEST)
async function fetchWebHotelierListings(store) {
  const propertyCode = store.api_key_name; // For WebHotelier, api_key_name IS the property code / username
  if (!propertyCode) {
    throw new Error('No API Key Name (property code / username) set on this store. Add it in Store settings.');
  }

  const authHeader = 'Basic ' + Buffer.from(`${propertyCode}:${store.api_key_secret}`).toString('base64');

  const res = await fetch(`https://rest.reserve-online.net/room/${propertyCode}`, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WebHotelier API error ${res.status}: ${body}`);
  }

  const data = await res.json();

  // WebHotelier API response: { data: { rooms: [...] } }
  // Handle various nesting levels
  const rooms = data?.data?.rooms || data?.rooms || (Array.isArray(data?.data) ? data.data : []);

  const listings = rooms.map(r => ({
    platform_id: String(r.code || r.id),
    name:        r.name || r.title || `Room ${r.code || r.id}`,
    capacity:    r.capacity?.max_pers ?? r.capacity?.max_persons ?? r.max_persons ?? r.max_capacity ?? null,
    unit_type:   r.unit_type || null,
    platform:    'webhotelier',
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_id: store.id,
      listings,
      platform: 'webhotelier',
      property_code: propertyCode,
    }),
  };
}
