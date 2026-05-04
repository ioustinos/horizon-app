// after-order.js
// Placeholder endpoint reserved for the post-order GonnaOrder webhook.
// Live and reachable at POST /api/after-order, but does nothing yet beyond
// captures the inbound request to webhook_logs so we have real payload
// samples on hand when we're ready to wire the real handler.
//
// Returns 200 with { acknowledged: true, placeholder: true } so the calling
// system gets a clean ack and doesn't retry.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const innerHandler = async (event) => {
  // CORS preflight — mirror validate-breakfast for consistency
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // Accept anything else, return a placeholder ack
  return ok({
    acknowledged: true,
    placeholder: true,
    endpoint: '/api/after-order',
    note: 'This endpoint is reserved and live, but does not process the request yet. The full payload has been captured in webhook_logs for review.',
  });
};

// Capture-everything wrapper (same pattern as validate-breakfast.js).
// Logs every inbound call to webhook_logs regardless of outcome.
export const handler = async (event) => {
  const start = Date.now();
  let result;
  try {
    result = await innerHandler(event);
  } catch (err) {
    result = error(500, err.message);
  }
  const duration = Date.now() - start;

  try {
    let parsedBody = null;
    try { parsedBody = JSON.parse(event.body || 'null'); } catch { parsedBody = { _raw: event.body }; }
    let parsedResp = null;
    try { parsedResp = JSON.parse(result?.body || 'null'); } catch { parsedResp = { _raw: result?.body }; }
    await supabase.from('webhook_logs').insert({
      endpoint: '/api/after-order',
      http_method: event.httpMethod,
      request_headers: event.headers || null,
      request_body: parsedBody,
      response_status: result?.statusCode ?? 500,
      response_body: parsedResp,
      duration_ms: duration,
      ip: event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'] || null,
    });
  } catch (logErr) {
    console.error('webhook_logs insert failed (after-order):', logErr);
  }

  return result;
};

// ── Helpers ─────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function ok(data) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(data),
  };
}

function error(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify({ error: message }),
  };
}
