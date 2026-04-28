// Guide.jsx — comprehensive in-platform walkthrough for new operators.
// Linked from the sidebar; intended to be readable end-to-end without
// outside context. Keep tone friendly and use small steps.

const styles = {
  page: { maxWidth: 880, margin: '0 auto', padding: '1rem 1.25rem 4rem', lineHeight: 1.55, color: '#1f2937' },
  h1: { fontSize: 32, marginBottom: 4 },
  lede: { color: '#475569', fontSize: 15, marginTop: 0, marginBottom: 24 },
  toc: { background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px', marginBottom: 28 },
  tocTitle: { margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: '#475569' },
  tocList: { margin: 0, paddingLeft: 18 },
  section: { borderTop: '1px solid #e2e8f0', paddingTop: 20, marginTop: 28 },
  h2: { fontSize: 22, marginTop: 0, marginBottom: 4, color: '#0f172a' },
  h2Number: { display: 'inline-block', width: 32, height: 32, lineHeight: '32px', textAlign: 'center', borderRadius: '50%', background: '#3b82f6', color: '#fff', fontSize: 14, marginRight: 10, verticalAlign: 'middle', fontWeight: 600 },
  h3: { fontSize: 17, marginTop: 22, marginBottom: 6, color: '#0f172a' },
  step: { background: '#fafafa', border: '1px solid #e2e8f0', borderLeft: '3px solid #3b82f6', borderRadius: 6, padding: '10px 14px', margin: '10px 0' },
  stepNum: { display: 'inline-block', minWidth: 22, fontWeight: 700, color: '#3b82f6', marginRight: 6 },
  tip: { background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: '10px 14px', margin: '14px 0', fontSize: 14 },
  warn: { background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '3px solid #ef4444', borderRadius: 6, padding: '10px 14px', margin: '14px 0', fontSize: 14 },
  good: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderLeft: '3px solid #22c55e', borderRadius: 6, padding: '10px 14px', margin: '14px 0', fontSize: 14 },
  code: { background: '#0f172a', color: '#f8fafc', padding: '8px 12px', borderRadius: 6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, display: 'block', overflowX: 'auto' },
  inlineCode: { background: '#e2e8f0', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', margin: '12px 0', fontSize: 14 },
  td: { borderBottom: '1px solid #e2e8f0', padding: '8px 10px', verticalAlign: 'top' },
  th: { background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#475569' },
  pageLink: { color: '#2563eb', textDecoration: 'none', fontWeight: 500 },
}

const Step = ({ n, children }) => (
  <div style={styles.step}>
    <span style={styles.stepNum}>{n}.</span>{children}
  </div>
)

export default function Guide() {
  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>How to use Horizon</h1>
      <p style={styles.lede}>
        A complete walkthrough — from creating a store to seeing a real GonnaOrder breakfast order
        validated against a HostHub booking. Read top to bottom the first time; later you can jump in via
        the table of contents.
      </p>

      <div style={styles.toc}>
        <p style={styles.tocTitle}>What you'll learn</p>
        <ol style={styles.tocList}>
          <li><a href="#what" style={styles.pageLink}>What Horizon does (the 30-second version)</a></li>
          <li><a href="#prep" style={styles.pageLink}>Before you begin — what you'll need</a></li>
          <li><a href="#store" style={styles.pageLink}>Step 1 — Create a Store</a></li>
          <li><a href="#fetch" style={styles.pageLink}>Step 2 — Fetch your rooms from the booking platform</a></li>
          <li><a href="#onboard" style={styles.pageLink}>Step 3 — Pick which rooms get breakfast</a></li>
          <li><a href="#sync" style={styles.pageLink}>Step 4 — Bookings sync (automatic, but you can force it)</a></li>
          <li><a href="#map" style={styles.pageLink}>Step 5 — Map your rooms into GonnaOrder</a></li>
          <li><a href="#webhook" style={styles.pageLink}>Step 6 — Wire up GonnaOrder's webhook</a></li>
          <li><a href="#monitor" style={styles.pageLink}>Step 7 — Monitor day-to-day</a></li>
          <li><a href="#trouble" style={styles.pageLink}>Troubleshooting</a></li>
        </ol>
      </div>

      {/* ── What is Horizon ───────────────────────────────────────────────────── */}
      <section id="what" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>?</span>What Horizon does</h2>
        <p>
          Horizon sits between three systems and decides whether a customer can order breakfast for free
          (because their stay includes it) or has to pay:
        </p>
        <ol>
          <li><strong>HostHub</strong> (or WebHotelier) tells Horizon who's checked into which room and whether breakfast is part of their booking.</li>
          <li><strong>GonnaOrder</strong> is the food-ordering app the guest uses (e.g. by scanning a QR code on the breakfast table).</li>
          <li><strong>Horizon's validator</strong> is called by GonnaOrder right before an order is placed. We check the booking, count how many free breakfasts are left for that room/day, and reply <em>"yes, this is covered"</em> or <em>"no, charge them"</em>.</li>
        </ol>
        <p>
          Each <strong>store</strong> in Horizon represents one GonnaOrder restaurant tied to one HostHub
          (or WebHotelier) account. Each <strong>room</strong> represents one rental that may have
          breakfast-included guests staying in it on any given day.
        </p>
      </section>

      {/* ── Prep ──────────────────────────────────────────────────────────────── */}
      <section id="prep" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>0</span>Before you begin</h2>
        <p>You'll want all of the following ready before starting. Don't worry — it's just the credentials, not the actual setup.</p>
        <ul>
          <li><strong>HostHub API key</strong> — generated from the client's HostHub account, under Settings → API Keys. (It's a string of letters and numbers, around 48 characters long.)</li>
          <li><strong>GonnaOrder Store ID</strong> — the numeric identifier of the GonnaOrder store. You can find it in the GonnaOrder admin URL or in the store settings.</li>
          <li><strong>Admin access to GonnaOrder</strong> for that store, so you can later (a) upload the rooms file and (b) configure the webhook.</li>
        </ul>
        <div style={styles.tip}>
          <strong>For WebHotelier customers</strong> instead of HostHub: you'll need an API username (also called the <em>property code</em>, e.g. <code style={styles.inlineCode}>HRZNTEST</code>) and an API password. The flow is otherwise identical.
        </div>
      </section>

      {/* ── Step 1: Store ─────────────────────────────────────────────────────── */}
      <section id="store" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>1</span>Create a Store</h2>
        <p>A store ties together one GonnaOrder restaurant + one booking platform account.</p>
        <Step n={1}>Click <a href="/admin/stores" style={styles.pageLink}>Stores</a> in the sidebar.</Step>
        <Step n={2}>Click the <strong>"+ New Store"</strong> button (top right).</Step>
        <Step n={3}>Fill in the form:
          <table style={styles.table}>
            <thead>
              <tr><th style={styles.th}>Field</th><th style={styles.th}>What to put</th></tr>
            </thead>
            <tbody>
              <tr><td style={styles.td}><strong>GonnaOrder Store Name *</strong></td><td style={styles.td}>A friendly name. Use the hotel/restaurant's actual name (e.g. "Kinfeel North").</td></tr>
              <tr><td style={styles.td}>Accommodation Company</td><td style={styles.td}>Who owns the rooms. Optional but useful when one company runs multiple stores.</td></tr>
              <tr><td style={styles.td}><strong>GonnaOrder Store ID *</strong></td><td style={styles.td}>The numeric ID GonnaOrder uses (e.g. <code style={styles.inlineCode}>8829</code>). Find it in the GonnaOrder admin URL.</td></tr>
              <tr><td style={styles.td}>Public Order Link</td><td style={styles.td}>The link guests use to open this store in GonnaOrder. Optional.</td></tr>
              <tr><td style={styles.td}><strong>Booking Platform *</strong></td><td style={styles.td}>HostHub, WebHotelier, or "Other" (manual rooms with a fixed max capacity, no booking sync).</td></tr>
              <tr><td style={styles.td}>API Key Name</td><td style={styles.td}>For HostHub: a label for the key (any text). For WebHotelier: <strong>required</strong> — the property code / username.</td></tr>
              <tr><td style={styles.td}><strong>API Key Secret *</strong></td><td style={styles.td}>For HostHub: paste the API key the client gave you, exactly as received. For WebHotelier: the API password.</td></tr>
            </tbody>
          </table>
        </Step>
        <Step n={4}>Click <strong>"Create Store"</strong>. The store now appears in the list.</Step>

        <div style={styles.warn}>
          <strong>About the HostHub API key:</strong> paste it raw, exactly as the client sent it. The key
          looks like a base64-encoded string, but that <em>is</em> the key — don't decode it. If the
          client sent it via WhatsApp, copy carefully: lowercase <code style={styles.inlineCode}>t</code>
          characters can look like dashes in green-highlighted text.
        </div>
      </section>

      {/* ── Step 2: Fetch ─────────────────────────────────────────────────────── */}
      <section id="fetch" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>2</span>Fetch your rooms from the booking platform</h2>
        <p>
          Fetching shows you everything the booking platform knows about — every rental in HostHub, every
          room type in WebHotelier. <em>Nothing is saved to Horizon yet.</em>
        </p>
        <Step n={1}>Click <a href="/admin/pull-listings" style={styles.pageLink}>Listings Sync</a> in the sidebar.</Step>
        <Step n={2}>Find your store's card and click <strong>"Fetch Listings"</strong> (top right of the card).</Step>
        <Step n={3}>Wait a few seconds. The card expands and you'll see a table with one row per rental.</Step>

        <div style={styles.tip}>
          <strong>What do the columns mean?</strong> <em>Listing Name</em> is what the room is called on
          the booking platform. <em>Platform ID</em> is its internal id (used as External Id in
          GonnaOrder later). <em>Status</em> says whether it's already been onboarded into Horizon.
        </div>

        <div style={styles.warn}>
          <strong>If you see "HostHub API error 401"</strong>: the API key isn't being accepted. Most
          common causes: (1) the key was pasted wrong (extra space, missing character, decoded by
          accident), (2) the key was deactivated on the HostHub side. Double-check with the client.
        </div>
      </section>

      {/* ── Step 3: Onboard ───────────────────────────────────────────────────── */}
      <section id="onboard" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>3</span>Pick which rooms get breakfast</h2>
        <p>
          Not every rental needs to be in Horizon — only the ones whose guests will be eating breakfast at
          the GonnaOrder restaurant. For each one you want to monitor:
        </p>
        <Step n={1}>Click <strong>"+ Serve breakfast to this listing"</strong> in the row's Actions column. The status badge turns green ("In Horizon").</Step>
        <Step n={2}>Repeat for each listing you want to onboard.</Step>

        <h3 style={styles.h3}>Faster: bulk onboarding + xlsx in one click</h3>
        <p>If you're onboarding many rooms at once:</p>
        <Step n={1}>Tick the checkbox at the start of each row you want (or the header checkbox to select all).</Step>
        <Step n={2}>Click <strong>"Onboard &amp; download create XLSX (N)"</strong> at the bottom of the table. This onboards every selected row that isn't already in Horizon, and immediately downloads a GonnaOrder-ready xlsx for them.</Step>

        <div style={styles.good}>
          <strong>What just happened internally:</strong> each onboarded room got a unique Horizon ID and is now ready to receive bookings (next step) and validate orders (step 6).
        </div>
      </section>

      {/* ── Step 4: Sync ──────────────────────────────────────────────────────── */}
      <section id="sync" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>4</span>Bookings sync — automatic, but you can force it</h2>
        <p>
          Horizon checks the booking platform every few minutes (configurable in <a href="/admin/settings" style={styles.pageLink}>Settings</a>) and pulls the latest reservations for every onboarded room. You don't have to do anything for this — it just runs.
        </p>
        <p>
          You'll see the synced bookings on the <a href="/admin/bookings" style={styles.pageLink}>Bookings</a> page.
        </p>

        <h3 style={styles.h3}>Force a sync now</h3>
        <Step n={1}>Go to <a href="/admin/stores" style={styles.pageLink}>Stores</a>.</Step>
        <Step n={2}>Click the <strong>"Force sync"</strong> button on the store's card. All onboarded rooms for that store re-sync immediately.</Step>

        <div style={styles.tip}>
          Bookings older than 30 days are automatically dropped — both at sync time and during cleanup. The Bookings page defaults its filter to "checked in within the last 7 days" to keep things tidy.
        </div>
      </section>

      {/* ── Step 5: Map to GonnaOrder ─────────────────────────────────────────── */}
      <section id="map" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>5</span>Map your rooms into GonnaOrder</h2>
        <p>
          GonnaOrder needs to know which Horizon room each of <em>its</em> rooms (called "locations" or "tables") corresponds to. We do this with the <strong>External Id</strong> field on each GonnaOrder location.
        </p>
        <p>
          Two paths depending on the situation:
        </p>

        <h3 style={styles.h3}>Path A — Empty / test GonnaOrder store</h3>
        <p>Use this when GonnaOrder doesn't yet have any rooms set up — perfect for a test account.</p>
        <Step n={1}>In <a href="/admin/pull-listings" style={styles.pageLink}>Listings Sync</a>, expand your store.</Step>
        <Step n={2}>Tick the rooms you want, then click <strong>"Onboard &amp; download create XLSX (N)"</strong>.</Step>
        <Step n={3}>An <code style={styles.inlineCode}>.xlsx</code> file downloads. Open GonnaOrder admin → <strong>Locations / Tables → Import</strong> → upload the file.</Step>
        <Step n={4}>Done. GonnaOrder creates one location per Horizon room, with the External Id correctly set.</Step>

        <h3 style={styles.h3}>Path B — Production: GonnaOrder already has rooms</h3>
        <p>Use this for real clients where GonnaOrder rooms exist and just need their External Id filled in. Importantly, this path will <strong>never create duplicate rooms</strong> in GonnaOrder.</p>
        <Step n={1}>In GonnaOrder admin, export the current locations as a <code style={styles.inlineCode}>Table_Import.xlsx</code>. Save it to your computer.</Step>
        <Step n={2}>In Horizon's <a href="/admin/pull-listings" style={styles.pageLink}>Listings Sync</a>, find your store, click <strong>"Map to GonnaOrder"</strong>.</Step>
        <Step n={3}>Click <strong>"Upload current GonnaOrder export"</strong> and pick the file from step 1.</Step>
        <Step n={4}>The page lists every GonnaOrder room, auto-matching by name where possible. For each:
          <ul>
            <li>Green-tinted rows are <strong>auto-matched</strong> — verify the dropdown is correct.</li>
            <li>Uncoloured rows are unmatched — pick the right Horizon room from the dropdown.</li>
            <li>Rows you don't want to touch can stay unmapped — they'll be dropped from the output.</li>
          </ul>
        </Step>
        <Step n={5}>Click <strong>"Download mapped XLSX (N)"</strong>.</Step>
        <Step n={6}>Upload that file in GonnaOrder. Each existing room gets its External Id filled in; nothing new is created.</Step>

        <div style={styles.warn}>
          <strong>Heads-up about the file format:</strong> GonnaOrder is strict about the Table Name column.
          It must be alphanumeric (uppercase letters, digits, dashes) and at most 10 characters. Horizon
          generates Table Names automatically from the room's platform ID, so you don't normally need to
          worry — but if you edit the file by hand, keep that rule in mind.
        </div>
      </section>

      {/* ── Step 6: Webhook ───────────────────────────────────────────────────── */}
      <section id="webhook" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>6</span>Wire up GonnaOrder's webhook</h2>
        <p>
          This is the bit that makes everything actually work end-to-end. GonnaOrder calls Horizon every time a customer is about to place an order, and Horizon decides yes/no.
        </p>
        <Step n={1}>In GonnaOrder admin, go to the store's <strong>Integrations</strong> or <strong>Webhooks</strong> settings.</Step>
        <Step n={2}>Add a new webhook with:
          <ul>
            <li><strong>URL:</strong>
              <code style={styles.code}>https://horizon-app-is.netlify.app/api/validate-breakfast</code>
            </li>
            <li><strong>Method:</strong> POST</li>
            <li><strong>Trigger:</strong> "Before order is placed" (the exact label varies by GonnaOrder version)</li>
            <li><strong>Content-Type:</strong> application/json</li>
          </ul>
        </Step>
        <Step n={3}>Save and test by placing a real order in the store.</Step>

        <div style={styles.tip}>
          <strong>Confirming the webhook fires:</strong> after a test order, open Webhook Logs (see step 7). You should see one row per order attempt, with the request payload and the response Horizon returned.
        </div>
      </section>

      {/* ── Step 7: Monitoring ────────────────────────────────────────────────── */}
      <section id="monitor" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>7</span>Monitor day-to-day</h2>
        <p>Once everything is wired up, these are the pages you'll glance at regularly:</p>
        <table style={styles.table}>
          <thead>
            <tr><th style={styles.th}>Page</th><th style={styles.th}>What it shows</th><th style={styles.th}>When to check it</th></tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}><a href="/admin/bookings" style={styles.pageLink}>Bookings</a></td>
              <td style={styles.td}>Every reservation we know about. Filter by store, room, date, breakfast-included.</td>
              <td style={styles.td}>Each morning to confirm today's check-ins are showing up; before resolving disputes.</td>
            </tr>
            <tr>
              <td style={styles.td}><a href="/admin/sync-logs" style={styles.pageLink}>Sync Logs</a></td>
              <td style={styles.td}>Each automated sync run, per room — how many bookings inserted/updated/skipped.</td>
              <td style={styles.td}>If something seems off with bookings, check here for failed syncs.</td>
            </tr>
            <tr>
              <td style={styles.td}><strong>Webhook Logs</strong> <em>(via DB)</em></td>
              <td style={styles.td}>Every call from GonnaOrder, regardless of outcome — payload, response, duration.</td>
              <td style={styles.td}>Investigating a "why didn't this order pass?" question.</td>
            </tr>
            <tr>
              <td style={styles.td}><strong>Orders</strong> <em>(via DB)</em></td>
              <td style={styles.td}>Validated orders that have or will consume breakfast covers.</td>
              <td style={styles.td}>To audit how many breakfasts have been served per room per day.</td>
            </tr>
            <tr>
              <td style={styles.td}><a href="/admin/settings" style={styles.pageLink}>Settings</a></td>
              <td style={styles.td}>Sync interval, lookback / forward windows.</td>
              <td style={styles.td}>Rarely. Defaults are sensible.</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── Troubleshooting ───────────────────────────────────────────────────── */}
      <section id="trouble" style={styles.section}>
        <h2 style={styles.h2}><span style={styles.h2Number}>!</span>Troubleshooting</h2>

        <h3 style={styles.h3}>"Fetch Listings" returns "API key not valid" / 401</h3>
        <ul>
          <li>Check the key is pasted exactly — no leading/trailing space, no missing character.</li>
          <li>For HostHub, the key looks base64-ish but the API expects it that way. Don't decode it.</li>
          <li>Confirm the client hasn't rotated/revoked the key on the HostHub side.</li>
        </ul>

        <h3 style={styles.h3}>An order returns "no_booking_found" but I can see a guest in HostHub</h3>
        <ul>
          <li>Check the booking date range covers the order's wish date (Bookings page → filter by room).</li>
          <li>Confirm the booking is <em>confirmed</em> (not cancelled) and <em>breakfast_included</em>.</li>
          <li>Force-sync the room from the Stores page in case the booking was added/changed after the last sync.</li>
        </ul>

        <h3 style={styles.h3}>An order returns "no_room_match"</h3>
        <ul>
          <li>The External Id GonnaOrder sent doesn't match any Horizon room for this store.</li>
          <li>Re-export the GonnaOrder rooms and re-do step 5 (Path B) to make sure External Ids are filled in.</li>
        </ul>

        <h3 style={styles.h3}>An order returns "exceeds_entitlement" but you think it shouldn't</h3>
        <ul>
          <li>Check the orders table — earlier orders for the same room/date count against the entitlement.</li>
          <li>The entitlement equals the booking's guest_count. If you serve more guests than the booking says, the extras are flagged.</li>
        </ul>

        <h3 style={styles.h3}>The webhook seems silent — no Webhook Logs entries after a real order</h3>
        <ul>
          <li>Confirm the webhook URL on GonnaOrder's side is exactly <code style={styles.inlineCode}>https://horizon-app-is.netlify.app/api/validate-breakfast</code> (no typos, no trailing slash).</li>
          <li>Check the trigger event — it should fire <em>before</em> the order is placed, not on the receipt.</li>
        </ul>

        <p style={{ marginTop: 24, color: '#475569', fontSize: 14 }}>
          Stuck on something not covered here? Open the row in Webhook Logs for the failing order, copy the payload + response, and share them — that's almost always enough to diagnose.
        </p>
      </section>
    </div>
  )
}
