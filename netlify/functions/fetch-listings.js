// fetch-listings.js
// GET /api/fetch-listings?store_id=<uuid>
// Fetches rental/room listings from the booking platform for a given store.
// Routes to the right provider based on the store's `platform` field.
//
// Provider-specific logic lives in netlify/functions/providers/*.js.

import { createClient } from '@supabase/supabase-js';
import { fetchHostHubListings }     from './providers/hosthub.js';
import { fetchWebHotelierListings } from './providers/webhotelier.js';
import { fetchRoomRackListings }    from './providers/roomrack.js';
import { fetchHotelizerListings }   from './providers/hotelizer.js';
import { fetchLodgifyListings }     from './providers/lodgify.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LISTING_PROVIDERS = {
  hosthub:     fetchHostHubListings,
  webhotelier: fetchWebHotelierListings,
  roomrack:    fetchRoomRackListings,
  hotelizer:   fetchHotelizerListings,
  lodgify:     fetchLodgifyListings,
};

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

  const provider = LISTING_PROVIDERS[store.platform];
  if (!provider) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: `Listings fetch not supported for platform: ${store.platform}` }),
    };
  }

  try {
    return await provider(store);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
