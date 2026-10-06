// probe-loggia-filters.js — READ-ONLY diagnostic (added 2026-10-07).
//
// Loggia's bookings/list `main_filter` values are undocumented (the vendor
// Postman collection lists the param with no values or descriptions). This
// probe calls ONE filter for ONE store's sync window and returns aggregate
// date statistics only, so we can tell empirically which date each filter
// applies to (creation vs arrival vs stay).
//
// GET /.netlify/functions/probe-loggia-filters?store_id=<uuid>&filter=custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
// Never writes to the DB. Returns no guest data — counts and min/max dates only.

import { supabase, offsetDate } from './providers/_shared.js';

const BASE = 'https://api.loggia.net';
const PAGE = 50;
const MAX_PAGES = 4;

export const handler = async (event) => {
  const q = event.queryStringParameters || {};
  const storeId = q.store_id;
  const filter = q.filter || 'custom';
  if (!storeId) return json(400, { error: 'store_id required' });

  const { data: store, error } = await supabase
    .from('stores').select('name, platform, api_key_name, api_key_secret').eq('id', storeId).single();
  if (error || !store) return json(404, { error: 'store not found' });
  if (store.platform !== 'loggia') return json(400, { error: 'not a loggia store' });

  const from = q.from || offsetDate(-30);
  const to = q.to || offsetDate(90);
  const rows = [];
  let pages = 0, httpStatus = 200, errText = null, truncated = false;
  const t0 = Date.now();

  for (; pages < MAX_PAGES; pages++) {
    const params = new URLSearchParams({
      page_id: String(store.api_key_name), main_filter: filter,
      date_from: from, date_to: to, date_year: from.slice(0, 4),
      source_types: 'all', limit: String(PAGE), offset: String(pages * PAGE),
    });
    const res = await fetch(`${BASE}/api/lodge/bookings/list?${params}`, {
      headers: { 'x-api-key': store.api_key_secret, Accept: 'application/json' },
    });
    httpStatus = res.status;
    if (!res.ok) { errText = (await res.text()).slice(0, 200); break; }
    const body = await res.json();
    const page = Array.isArray(body) ? body : (body.reservations || body.data || body.bookings || []);
    rows.push(...page);
    if (page.length < PAGE) break;
    if (pages === MAX_PAGES - 1) truncated = true;
  }

  const created = rows.map(r => parseDMY(r.created)).filter(Boolean).sort();
  const checkin = rows.map(r => String(r.checkin_day || '').slice(0, 10)).filter(Boolean).sort();
  const checkout = rows.map(r => String(r.checkout_day || '').slice(0, 10)).filter(Boolean).sort();

  return json(200, {
    store: store.name, filter, window: { from, to }, http_status: httpStatus, error: errText,
    ms: Date.now() - t0, pages_fetched: pages + (errText ? 0 : 1), truncated_at_200: truncated,
    count: rows.length,
    created:  { min: created[0] || null,  max: created.at(-1) || null,
                before_from: created.filter(d => d < from).length },
    checkin:  { min: checkin[0] || null,  max: checkin.at(-1) || null,
                before_from: checkin.filter(d => d < from).length,
                after_to: checkin.filter(d => d > to).length },
    checkout: { min: checkout[0] || null, max: checkout.at(-1) || null },
    stay_overlaps_window: rows.filter(r => String(r.checkin_day) <= to && String(r.checkout_day) >= from).length,
    canceled: rows.filter(r => r.canceled != null && r.canceled !== '').length,
  });
};

function parseDMY(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})/.exec(String(s || ''));
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2]}-${m[1]}`;
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}
