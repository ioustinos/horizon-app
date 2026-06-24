// Guide.jsx — comprehensive in-platform walkthrough.
// Uses a single scoped <style> block (via the .horizon-guide class on the
// page root) to keep CSS local without a build-time CSS-modules dance.

const css = `
.horizon-guide { max-width: 880px; margin: 0 auto; padding: 0.5rem 1.25rem 5rem; line-height: 1.6; color: #1f2937; font-size: 15px; }
.horizon-guide h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; color: #0f172a; }
.horizon-guide .lede { color: #475569; font-size: 16px; margin: 0 0 24px; }
.horizon-guide .toc { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 20px; margin-bottom: 32px; }
.horizon-guide .toc-title { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #475569; font-weight: 600; }
.horizon-guide .toc ol { margin: 0; padding-left: 20px; }
.horizon-guide .toc li { margin: 2px 0; }
.horizon-guide .toc a { color: #2563eb; text-decoration: none; }
.horizon-guide .toc a:hover { text-decoration: underline; }

.horizon-guide section.step-section { border-top: 1px solid #e2e8f0; padding-top: 28px; margin-top: 32px; }
.horizon-guide .h2-row { display: flex; align-items: center; gap: 12px; margin: 0 0 4px; }
.horizon-guide .h2-badge { flex: 0 0 36px; width: 36px; height: 36px; border-radius: 50%; background: #3b82f6; color: #fff; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; line-height: 1; }
.horizon-guide .h2-row h2 { margin: 0; font-size: 22px; line-height: 1.2; color: #0f172a; }
.horizon-guide .h2-sub { color: #64748b; font-size: 14px; margin: 0 0 14px 48px; }

.horizon-guide h3 { font-size: 17px; margin: 24px 0 8px; color: #0f172a; }
.horizon-guide p { margin: 0 0 12px; }
.horizon-guide ul, .horizon-guide ol { margin: 0 0 12px; padding-left: 22px; }
.horizon-guide li { margin: 4px 0; }
.horizon-guide a { color: #2563eb; text-decoration: none; }
.horizon-guide a:hover { text-decoration: underline; }

.horizon-guide .step { display: flex; gap: 12px; align-items: flex-start; background: #fafafa; border: 1px solid #e2e8f0; border-left: 3px solid #3b82f6; border-radius: 6px; padding: 12px 14px; margin: 8px 0; }
.horizon-guide .step-num { flex: 0 0 26px; font-weight: 700; color: #3b82f6; line-height: 1.5; font-variant-numeric: tabular-nums; }
.horizon-guide .step-body { flex: 1; min-width: 0; }
.horizon-guide .step-body > :first-child { margin-top: 0; }
.horizon-guide .step-body > :last-child { margin-bottom: 0; }

.horizon-guide .callout { padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 14.5px; }
.horizon-guide .callout strong:first-child { display: inline-block; }
.horizon-guide .callout > :first-child { margin-top: 0; }
.horizon-guide .callout > :last-child { margin-bottom: 0; }
.horizon-guide .callout.tip { background: #fffbeb; border: 1px solid #fde68a; border-left: 3px solid #f59e0b; }
.horizon-guide .callout.warn { background: #fef2f2; border: 1px solid #fecaca; border-left: 3px solid #ef4444; }
.horizon-guide .callout.good { background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 3px solid #22c55e; }
.horizon-guide .callout.info { background: #eff6ff; border: 1px solid #bfdbfe; border-left: 3px solid #3b82f6; }

.horizon-guide code { background: #e2e8f0; padding: 1px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; }
.horizon-guide pre { background: #0f172a; color: #f8fafc; padding: 10px 14px; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-x: auto; margin: 8px 0; line-height: 1.4; }
.horizon-guide pre code { background: transparent; color: inherit; padding: 0; word-break: normal; }

.horizon-guide table.guide-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14.5px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
.horizon-guide table.guide-table th { background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 9px 12px; text-align: left; font-weight: 600; font-size: 13px; color: #475569; }
.horizon-guide table.guide-table td { border-bottom: 1px solid #f1f5f9; padding: 10px 12px; vertical-align: top; }
.horizon-guide table.guide-table tr:last-child td { border-bottom: 0; }

.horizon-guide .schematic { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
.horizon-guide .schematic svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.horizon-guide .schematic-caption { color: #64748b; font-size: 13px; text-align: center; margin: 8px 0 0; }

.horizon-guide .path-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin: 16px 0; }
@media (min-width: 720px) { .horizon-guide .path-grid { grid-template-columns: 1fr 1fr; } }
.horizon-guide .path-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
.horizon-guide .path-card.path-a { border-top: 3px solid #22c55e; }
.horizon-guide .path-card.path-b { border-top: 3px solid #3b82f6; }
.horizon-guide .path-card h4 { margin: 0 0 4px; font-size: 16px; }
.horizon-guide .path-card .path-when { color: #64748b; font-size: 13px; margin-bottom: 12px; }
`

// ── Step component ─────────────────────────────────────────────────────────
const Step = ({ n, children }) => (
  <div className="step">
    <span className="step-num">{n}.</span>
    <div className="step-body">{children}</div>
  </div>
)

// ── SVG schematics ─────────────────────────────────────────────────────────

// System overview: HostHub ⟷ Horizon ⟷ GonnaOrder
function SystemSchematic() {
  return (
    <div className="schematic">
      <svg viewBox="0 0 760 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Horizon system overview">
        <defs>
          <marker id="arr1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#475569"/>
          </marker>
        </defs>
        {/* Three main boxes */}
        <g>
          <rect x="20" y="60" width="200" height="120" rx="10" fill="#fff" stroke="#94a3b8" strokeWidth="1.5"/>
          <text x="120" y="92" textAnchor="middle" fontFamily="system-ui" fontSize="15" fontWeight="700" fill="#0f172a">Booking platform</text>
          <text x="120" y="112" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#475569">HostHub · WebHotelier · RoomRack · Hotelizer · Cloudbeds · Loggia · Hostaway</text>
          <text x="120" y="142" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#64748b">Source of bookings</text>
          <text x="120" y="160" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#64748b">+ rental listings</text>
        </g>
        <g>
          <rect x="280" y="40" width="200" height="160" rx="10" fill="#eff6ff" stroke="#3b82f6" strokeWidth="2"/>
          <text x="380" y="76" textAnchor="middle" fontFamily="system-ui" fontSize="16" fontWeight="800" fill="#1e3a8a">Horizon</text>
          <text x="380" y="106" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#1e40af">Pulls bookings every 5 min</text>
          <text x="380" y="124" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#1e40af">Stores rooms ↔ bookings</text>
          <text x="380" y="142" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#1e40af">Validates orders live</text>
          <text x="380" y="174" textAnchor="middle" fontFamily="system-ui" fontSize="11" fill="#64748b">"is this guest covered?"</text>
        </g>
        <g>
          <rect x="540" y="60" width="200" height="120" rx="10" fill="#fff" stroke="#94a3b8" strokeWidth="1.5"/>
          <text x="640" y="92" textAnchor="middle" fontFamily="system-ui" fontSize="15" fontWeight="700" fill="#0f172a">GonnaOrder</text>
          <text x="640" y="112" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#475569">(food ordering)</text>
          <text x="640" y="142" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#64748b">Guest scans QR</text>
          <text x="640" y="160" textAnchor="middle" fontFamily="system-ui" fontSize="12" fill="#64748b">Asks to validate order</text>
        </g>
        {/* Arrows */}
        <g stroke="#475569" strokeWidth="1.5" fill="none" markerEnd="url(#arr1)">
          <line x1="220" y1="105" x2="276" y2="105"/>
          <line x1="540" y1="105" x2="484" y2="105"/>
        </g>
        <text x="248" y="98" fontFamily="system-ui" fontSize="11" fill="#475569" textAnchor="middle">API sync</text>
        <text x="512" y="98" fontFamily="system-ui" fontSize="11" fill="#475569" textAnchor="middle">webhook</text>
        <line x1="276" y1="135" x2="220" y2="135" stroke="#94a3b8" strokeDasharray="3 3" fill="none"/>
        <line x1="484" y1="135" x2="540" y2="135" stroke="#94a3b8" strokeDasharray="3 3" fill="none" markerEnd="url(#arr1)"/>
        <text x="512" y="153" fontFamily="system-ui" fontSize="11" fill="#475569" textAnchor="middle">yes / no</text>
        {/* Bottom annotation */}
        <text x="380" y="240" textAnchor="middle" fontFamily="system-ui" fontSize="13" fill="#475569">
          Horizon decides — for each order, in real time — whether breakfast is included in the guest's stay.
        </text>
      </svg>
    </div>
  )
}

// Validation flow — sequence-style
function ValidationSchematic() {
  return (
    <div className="schematic">
      <svg viewBox="0 0 720 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Order validation sequence">
        <defs>
          <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#1e3a8a"/>
          </marker>
        </defs>
        {/* Lifelines */}
        {[
          {x: 110, label: 'Guest', color: '#7c3aed'},
          {x: 290, label: 'GonnaOrder', color: '#0f172a'},
          {x: 470, label: 'Horizon', color: '#1e3a8a'},
          {x: 640, label: 'Database', color: '#0f172a'},
        ].map(({x, label, color}) => (
          <g key={label}>
            <rect x={x-60} y="20" width="120" height="34" rx="6" fill="#fff" stroke={color} strokeWidth="1.5"/>
            <text x={x} y="42" textAnchor="middle" fontFamily="system-ui" fontSize="13" fontWeight="600" fill={color}>{label}</text>
            <line x1={x} y1="54" x2={x} y2="290" stroke="#cbd5e1" strokeDasharray="2 4"/>
          </g>
        ))}
        {/* Messages */}
        <g fontFamily="system-ui" fontSize="12" fill="#0f172a">
          <line x1="110" y1="86" x2="290" y2="86" stroke="#1e3a8a" strokeWidth="1.5" markerEnd="url(#arr2)"/>
          <text x="200" y="78" textAnchor="middle">scans QR + adds breakfast</text>

          <line x1="290" y1="130" x2="470" y2="130" stroke="#1e3a8a" strokeWidth="1.5" markerEnd="url(#arr2)"/>
          <text x="380" y="122" textAnchor="middle">POST /api/validate-breakfast</text>
          <text x="380" y="146" textAnchor="middle" fill="#64748b">store, room (External Id), wishTime, items</text>

          <line x1="470" y1="186" x2="640" y2="186" stroke="#1e3a8a" strokeWidth="1.5" markerEnd="url(#arr2)"/>
          <text x="555" y="178" textAnchor="middle">find booking covering wishTime</text>

          <line x1="640" y1="218" x2="470" y2="218" stroke="#1e3a8a" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arr2)"/>
          <text x="555" y="234" textAnchor="middle" fill="#64748b">guest_count, breakfast_included</text>

          <line x1="470" y1="266" x2="290" y2="266" stroke="#1e3a8a" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arr2)"/>
          <text x="380" y="258" textAnchor="middle">{`{ valid: true | false, reason, remaining }`}</text>
          <text x="380" y="282" textAnchor="middle" fill="#64748b">decision in ~1 second</text>
        </g>
      </svg>
    </div>
  )
}

// Mapping flow — Path A vs Path B
function MappingSchematic() {
  return (
    <div className="schematic">
      <svg viewBox="0 0 720 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two paths for mapping rooms to GonnaOrder">
        <defs>
          <marker id="arr3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#475569"/>
          </marker>
        </defs>
        {/* Path A — top */}
        <g>
          <rect x="20" y="20" width="680" height="120" rx="10" fill="#f0fdf4" stroke="#22c55e" strokeWidth="1.5"/>
          <text x="40" y="46" fontFamily="system-ui" fontSize="14" fontWeight="700" fill="#166534">Path A · Empty test GonnaOrder store</text>
          <g fontFamily="system-ui" fontSize="12" fill="#0f172a">
            <rect x="40" y="64" width="140" height="50" rx="6" fill="#fff" stroke="#86efac"/>
            <text x="110" y="86" textAnchor="middle" fontWeight="600">Horizon rooms</text>
            <text x="110" y="102" textAnchor="middle" fill="#64748b">selected list</text>

            <line x1="180" y1="89" x2="240" y2="89" stroke="#475569" markerEnd="url(#arr3)"/>
            <text x="210" y="80" textAnchor="middle" fontSize="11" fill="#475569">download</text>

            <rect x="240" y="64" width="160" height="50" rx="6" fill="#fff" stroke="#86efac"/>
            <text x="320" y="86" textAnchor="middle" fontWeight="600">create xlsx</text>
            <text x="320" y="102" textAnchor="middle" fill="#64748b">External Id pre-filled</text>

            <line x1="400" y1="89" x2="460" y2="89" stroke="#475569" markerEnd="url(#arr3)"/>
            <text x="430" y="80" textAnchor="middle" fontSize="11" fill="#475569">upload</text>

            <rect x="460" y="64" width="220" height="50" rx="6" fill="#fff" stroke="#86efac"/>
            <text x="570" y="86" textAnchor="middle" fontWeight="600">GonnaOrder creates</text>
            <text x="570" y="102" textAnchor="middle" fill="#64748b">new locations from file</text>
          </g>
        </g>
        {/* Path B — bottom */}
        <g>
          <rect x="20" y="170" width="680" height="130" rx="10" fill="#eff6ff" stroke="#3b82f6" strokeWidth="1.5"/>
          <text x="40" y="196" fontFamily="system-ui" fontSize="14" fontWeight="700" fill="#1e3a8a">Path B · Production: rooms already exist in GonnaOrder</text>
          <g fontFamily="system-ui" fontSize="12" fill="#0f172a">
            <rect x="40" y="216" width="140" height="50" rx="6" fill="#fff" stroke="#93c5fd"/>
            <text x="110" y="238" textAnchor="middle" fontWeight="600">GonnaOrder export</text>
            <text x="110" y="254" textAnchor="middle" fill="#64748b">Tables → Update via Excel</text>

            <line x1="180" y1="241" x2="240" y2="241" stroke="#475569" markerEnd="url(#arr3)"/>
            <text x="210" y="232" textAnchor="middle" fontSize="11" fill="#475569">upload</text>

            <rect x="240" y="216" width="160" height="50" rx="6" fill="#fff" stroke="#93c5fd"/>
            <text x="320" y="238" textAnchor="middle" fontWeight="600">Horizon auto-matches</text>
            <text x="320" y="254" textAnchor="middle" fill="#64748b">by name; you fix rest</text>

            <line x1="400" y1="241" x2="460" y2="241" stroke="#475569" markerEnd="url(#arr3)"/>
            <text x="430" y="232" textAnchor="middle" fontSize="11" fill="#475569">download</text>

            <rect x="460" y="216" width="220" height="50" rx="6" fill="#fff" stroke="#93c5fd"/>
            <text x="570" y="238" textAnchor="middle" fontWeight="600">mapped xlsx → upsert</text>
            <text x="570" y="254" textAnchor="middle" fill="#64748b">fills External Id only · no creates</text>
          </g>
        </g>
      </svg>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Guide() {
  return (
    <div className="horizon-guide">
      <style>{css}</style>

      <h1>How to use Horizon</h1>
      <p className="lede">
        A complete walkthrough — from creating a store to seeing a real GonnaOrder breakfast order
        validated against a booking from your PMS (HostHub, WebHotelier, RoomRack, Hotelizer, Cloudbeds, Loggia, or Hostaway).
        Read top to bottom the first time; later you can jump in via the table of contents.
      </p>

      <div className="toc">
        <p className="toc-title">What you'll learn</p>
        <ol>
          <li><a href="#what">What Horizon does (the 30-second version)</a></li>
          <li><a href="#prep">Before you begin — what you'll need</a></li>
          <li><a href="#store">Step 1 — Create a Store</a></li>
          <li><a href="#fetch">Step 2 — Fetch your rooms from the booking platform</a></li>
          <li><a href="#onboard">Step 3 — Pick which rooms get breakfast</a></li>
          <li><a href="#sync">Step 4 — Bookings sync (automatic, but you can force it)</a></li>
          <li><a href="#map">Step 5 — Map your rooms into GonnaOrder</a></li>
          <li><a href="#webhook">Step 6 — Wire up GonnaOrder's webhook</a></li>
          <li><a href="#monitor">Step 7 — Monitor day-to-day</a></li>
          <li><a href="#trouble">Troubleshooting</a></li>
        </ol>
      </div>

      {/* ── What ──────────────────────────────────────────────────────────── */}
      <section id="what" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">?</span>
          <h2>What Horizon does</h2>
        </div>
        <p className="h2-sub">The 30-second version.</p>
        <p>
          Horizon sits between three systems and decides whether a customer can order breakfast for
          free (because their stay includes it) or has to pay:
        </p>

        <SystemSchematic />
        <p className="schematic-caption">Horizon is the validator in the middle — connecting bookings to orders.</p>

        <ol>
          <li><strong>The booking platform</strong> (HostHub, WebHotelier, RoomRack, Hotelizer, Cloudbeds, Loggia, or Hostaway) tells Horizon who's checked into which room and whether breakfast is included in their booking.</li>
          <li><strong>GonnaOrder</strong> is the food-ordering app the guest uses (e.g. by scanning a QR code on the breakfast table).</li>
          <li><strong>Horizon's validator</strong> is called by GonnaOrder right before an order is placed. We check the booking, count how many free breakfasts are left for that room/day, and reply <em>"yes, this is covered"</em> or <em>"no, charge them"</em>.</li>
        </ol>

        <h3>What happens when a guest orders</h3>
        <ValidationSchematic />
        <p className="schematic-caption">A typical successful validation takes about a second end-to-end.</p>

        <p>
          Each <strong>store</strong> in Horizon represents one GonnaOrder restaurant tied to one
          booking-platform account (HostHub, WebHotelier, RoomRack, Hotelizer, Cloudbeds, Loggia, or Hostaway). Each <strong>room</strong>
          represents one rental that may have breakfast-included guests staying in it on any given day.
        </p>
      </section>

      {/* ── Prep ──────────────────────────────────────────────────────────── */}
      <section id="prep" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">0</span>
          <h2>Before you begin</h2>
        </div>
        <p className="h2-sub">What credentials to gather first.</p>
        <p>You'll want all of the following ready before starting. Don't worry — it's just credentials, not the actual setup.</p>
        <ul>
          <li>
            <strong>Booking-platform credentials</strong> — depending on which PMS the client uses:
            <ul>
              <li><strong>HostHub:</strong> API key from the client's HostHub account, under <em>Settings → API Keys</em>. ~48-character string of letters and numbers.</li>
              <li><strong>WebHotelier:</strong> API username (also called the <em>property code</em>, e.g. <code>HRZNTEST</code>) and an API password.</li>
              <li><strong>RoomRack:</strong> a per-property <em>ApiToken</em> (UUID-shaped). The client enables it in their RoomRack PMS at <em>Setup → Device Interface → General API / Partners API</em>; the token appears there once activated.</li>
              <li><strong>Hotelizer:</strong> a Basic Auth username + password issued by Hotelizer per property. A public demo property is available with <code>username</code> / <code>pass</code> for testing — see <a href="https://hotelizer.gitbook.io/hotelizer-api/guidelines" target="_blank" rel="noreferrer">the Hotelizer docs</a>.</li>
              <li><strong>Cloudbeds:</strong> a per-property API key (starts with <code>cbat_</code>) plus the numeric <strong>Cloudbeds Property ID</strong>. The property generates the key themselves from inside their Cloudbeds account. See the <em>Cloudbeds stores: walking the property through API key creation</em> section below for the full step-by-step you can forward to them.</li>
              <li><strong>Loggia:</strong> a numeric <strong>Page ID</strong> (e.g. <code>4634</code>) plus a separately issued <strong>API key</strong>, both provided by Loggia. Page ID = the username field; API key = the secret. Sent as the <code>x-api-key</code> header on every call. Loggia is part of the Webhotelier family but uses its own API surface (<code>api.loggia.net</code>) — short-term-rental focused; properties map to whole vacation units rather than hotel rooms.</li>
              <li><strong>Hostaway:</strong> the numeric <strong>account_id</strong> + an <strong>API key</strong> (~64 hex chars) generated in the Hostaway dashboard via <em>Get API client secret</em>. Horizon uses these as OAuth <code>client_id</code>/<code>client_secret</code> to issue a Bearer token (24-month TTL, cached). One account unlocks all listings on that account. Hostaway is short-term-rental focused (Airbnb / Booking.com / Vrbo aggregator). Breakfast detection: listings tagged with the <em>Breakfast</em> or <em>Meal included</em> amenity flip on automatically; otherwise per-store ALWAYS/NEVER override.</li>
            </ul>
          </li>
          <li><strong>GonnaOrder Store ID</strong> — the numeric identifier of the GonnaOrder store. You can find it in the GonnaOrder admin URL or in the store settings.</li>
          <li><strong>Admin access to GonnaOrder</strong> for that store, so you can later (a) upload the rooms file and (b) configure the webhook.</li>
        </ul>
        <div className="callout tip">
          <strong>One store per (PMS account, GonnaOrder restaurant) pair.</strong> If a single
          accommodation company runs multiple properties on different PMSes, create one Horizon
          store per property — they each have their own credentials and onboarded rooms.
        </div>
      </section>

      {/* ── Step 1: Store ─────────────────────────────────────────────────── */}
      <section id="store" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">1</span>
          <h2>Create a Store</h2>
        </div>
        <p className="h2-sub">A store ties together one GonnaOrder restaurant + one booking platform account.</p>

        <Step n={1}>Click <a href="/admin/stores">Stores</a> in the sidebar.</Step>
        <Step n={2}>Click the <strong>"+ New Store"</strong> button (top right).</Step>
        <Step n={3}>
          Fill in the form:
          <table className="guide-table">
            <thead>
              <tr><th>Field</th><th>What to put</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>GonnaOrder Store Name *</strong></td><td>A friendly name. Use the hotel/restaurant's actual name (e.g. "Kinfeel North").</td></tr>
              <tr><td>Accommodation Company</td><td>Who owns the rooms. Optional but useful when one company runs multiple stores.</td></tr>
              <tr><td><strong>GonnaOrder Store ID *</strong></td><td>The numeric ID GonnaOrder uses (e.g. <code>8829</code>). Find it in the GonnaOrder admin URL.</td></tr>
              <tr><td>Public Order Link</td><td>The link guests use to open this store in GonnaOrder. Optional.</td></tr>
              <tr><td><strong>Booking Platform *</strong></td><td>HostHub, WebHotelier, RoomRack, Hotelizer, Cloudbeds, Loggia, Hostaway, or "Other" (manual rooms with a fixed max capacity, no booking sync).</td></tr>
              <tr><td>API Key Name <em>/ Username / Property ID</em></td><td>For HostHub: a label for the key (any text). For WebHotelier: <strong>required</strong> — the property code / username. For Hotelizer: <strong>required</strong> — the Basic Auth username. For Cloudbeds: <strong>required</strong> — the numeric Cloudbeds <em>propertyID</em> (e.g. <code>320653</code>). For Loggia: <strong>required</strong> — the numeric Loggia <em>page_id</em> (e.g. <code>4634</code>). For Hostaway: <strong>required</strong> — the numeric Hostaway <em>account_id</em> (e.g. <code>182649</code>). RoomRack doesn't use this field.</td></tr>
              <tr><td><strong>API Key Secret *</strong> <em>/ Password / Token</em></td><td>For HostHub: paste the API key the client gave you, exactly as received. For WebHotelier: the API password. For RoomRack: the ApiToken (UUID-shaped). For Hotelizer: the Basic Auth password. For Cloudbeds: the <code>cbat_…</code> API key issued in the Cloudbeds Marketplace. For Loggia: the API key provided by Loggia (sent as <code>x-api-key</code> header). For Hostaway: the API key from the Hostaway dashboard (used as OAuth client secret).</td></tr>
            </tbody>
          </table>
        </Step>
        <Step n={4}>Click <strong>"Create Store"</strong>. The store now appears in the list.</Step>

        <div className="callout warn">
          <strong>About the HostHub API key:</strong> paste it raw, exactly as the client sent it. The
          key looks like a base64-encoded string, but that <em>is</em> the key — don't decode it. If
          the client sent it via WhatsApp, copy carefully: lowercase <code>t</code> characters can
          look like dashes in green-highlighted text.
        </div>

        <h3>HostHub stores: configure breakfast keywords</h3>
        <p>
          HostHub bookings carry a free-text <code>meal_plan</code> field that the host fills in
          (e.g. <em>"Στην τιμή δωματίου περιλαμβάνεται πρωινό"</em>, <em>"BB"</em>,
          <em>"Half Board"</em>). To distinguish breakfast-included bookings from room-only ones,
          fill the <strong>Breakfast — meal-plan keywords</strong> section in the store form with
          one keyword per line. A booking is treated as breakfast-included when its
          <code>meal_plan</code> field contains <strong>any</strong> of those keywords as a
          substring (case-insensitive).
        </p>
        <p>
          Leave the field blank to keep the legacy default — every HostHub booking is treated as
          breakfast-included. Useful for properties where the rate plan implies breakfast for all
          stays.
        </p>

        <h3>Cloudbeds stores: walking the property through API key creation</h3>
        <p>
          Cloudbeds API access is self-serve from inside each property's account — they fill out
          a short form and Cloudbeds issues a one-time API key. Forward the steps below to the
          property contact verbatim (translate to Greek if needed):
        </p>
        <ol>
          <li>
            Log in to Cloudbeds → <strong>Account</strong> → <strong>Apps &amp; Marketplace</strong>{' '}
            → <strong>API Credentials</strong> → <strong>+ New Credentials</strong>.
          </li>
          <li>
            Fill the form with these values:
            <table className="guide-table">
              <thead>
                <tr><th>Field</th><th>What to put</th></tr>
              </thead>
              <tbody>
                <tr><td><strong>Credentials Name</strong></td><td><code>Horizon</code> (or any descriptive label)</td></tr>
                <tr><td><strong>Integration Type</strong></td><td><strong>Point of Sale (POS)</strong> — GonnaOrder is the POS; Horizon is read-only middleware sitting in front of it</td></tr>
                <tr><td><strong>Redirect URI</strong></td><td><code>https://localhost</code> — the field is required by the form but Horizon doesn't use OAuth redirects, so anything works</td></tr>
                <tr><td><strong>Scopes</strong></td><td>Tick exactly these 8 read-only boxes: <code>read:reservation</code>, <code>read:room</code>, <code>read:guest</code>, <code>read:hotel</code>, <code>read:rate</code>, <code>read:addon</code>, <code>read:package</code>, <code>read:customFields</code>. Nothing else.</td></tr>
              </tbody>
            </table>
          </li>
          <li>Click <strong>Create API Key</strong> → on the consent screen, click <strong>Allow Access</strong>.</li>
          <li>
            Cloudbeds shows the API key (starts with <code>cbat_…</code>) in a modal —{' '}
            <strong>only once</strong>. The property must copy it before closing the modal. If lost,
            the only recovery is to delete the credentials entry and reissue.
          </li>
          <li>
            The property sends back <strong>two</strong> values: (a) the <code>cbat_…</code> API key,
            and (b) their <strong>Property ID</strong> — the numeric ID visible in the URL when they're
            inside their property, e.g. <code>hotels.cloudbeds.com/connect/<strong>123456</strong></code>{' '}
            → Property ID is <code>123456</code>.
          </li>
        </ol>
        <div className="callout tip">
          <strong>Why Point of Sale (POS)?</strong> The other Integration Types in the Cloudbeds
          dropdown (Channel Manager, PMS, Booking Engine, Revenue Management, etc.) describe systems
          that <em>write</em> to Cloudbeds. Horizon only reads reservation data on behalf of a POS
          (GonnaOrder), so POS is the right classification. Picking another type doesn't break the
          integration but mislabels what we are inside the property's Cloudbeds account audit log.
        </div>
        <div className="callout warn">
          <strong>The key is shown once.</strong> If the property closes the modal before copying,
          the key is unrecoverable. Always warn them about this <em>before</em> they click Create.
          Recovery means deleting the credentials entry and creating a new one — fine, but adds
          another round-trip.
        </div>
        <p>
          With both values in hand, create the store in <a href="/admin/stores">Stores</a> using
          <code>api_key_name</code> = the Property ID and <code>api_key_secret</code> = the{' '}
          <code>cbat_…</code> key (see the form table above for the exact fields).
        </p>

      </section>

      {/* ── Step 2: Fetch ─────────────────────────────────────────────────── */}
      <section id="fetch" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">2</span>
          <h2>Fetch your rooms from the booking platform</h2>
        </div>
        <p className="h2-sub">See every rental the booking platform knows about. Nothing is saved yet.</p>

        <Step n={1}>Click <a href="/admin/pull-listings">Listings Sync</a> in the sidebar.</Step>
        <Step n={2}>Find your store's card and click <strong>"Fetch Listings"</strong> (top right of the card).</Step>
        <Step n={3}>Wait a few seconds. The card expands and you'll see a table with one row per rental.</Step>

        <div className="callout tip">
          <strong>What do the columns mean?</strong> <em>Listing Name</em> is what the room is called
          on the booking platform. <em>Platform ID</em> is its internal id (used as External Id in
          GonnaOrder later). <em>Status</em> says whether it's already been onboarded into Horizon.
        </div>

        <div className="callout warn">
          <strong>If you see "HostHub API error 401"</strong>: the API key isn't being accepted. Most
          common causes: (1) the key was pasted wrong (extra space, missing character, decoded by
          accident), (2) the key was deactivated on the HostHub side. Double-check with the client.
        </div>
      </section>

      {/* ── Step 3: Onboard ───────────────────────────────────────────────── */}
      <section id="onboard" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">3</span>
          <h2>Pick which rooms get breakfast</h2>
        </div>
        <p className="h2-sub">Only rooms whose guests will be eating breakfast at the GonnaOrder restaurant.</p>

        <p>For each rental you want to monitor:</p>
        <Step n={1}>Click <strong>"+ Serve breakfast to this listing"</strong> in the row's Actions column. The status badge turns green ("In Horizon").</Step>
        <Step n={2}>Repeat for each listing you want to onboard.</Step>

        <h3>Faster: bulk onboarding + xlsx in one click</h3>
        <p>If you're onboarding many rooms at once:</p>
        <Step n={1}>Tick the checkbox at the start of each row you want (or the header checkbox to select all).</Step>
        <Step n={2}>Click <strong>"Onboard &amp; download create XLSX (N)"</strong> at the bottom of the table. This onboards every selected row that isn't already in Horizon, and immediately downloads a GonnaOrder-ready xlsx for them.</Step>

        <div className="callout good">
          <strong>What just happened internally:</strong> each onboarded room got a unique Horizon ID
          and is now ready to receive bookings (next step) and validate orders (step 6).
        </div>
      </section>

      {/* ── Step 4: Sync ──────────────────────────────────────────────────── */}
      <section id="sync" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">4</span>
          <h2>Bookings sync — automatic, but you can force it</h2>
        </div>
        <p className="h2-sub">Set and forget. We pull bookings every few minutes per onboarded room.</p>

        <p>
          Horizon checks the booking platform every few minutes (configurable in {' '}
          <a href="/admin/settings">Settings</a>) and pulls the latest reservations for every
          onboarded room. You don't have to do anything for this — it just runs.
        </p>
        <p>
          You'll see the synced bookings on the <a href="/admin/bookings">Bookings</a> page.
        </p>

        <h3>Force a sync now</h3>
        <Step n={1}>Go to <a href="/admin/stores">Stores</a>.</Step>
        <Step n={2}>Click the <strong>"Force sync"</strong> button on the store's card. All onboarded rooms for that store re-sync immediately.</Step>

        <div className="callout tip">
          Bookings older than 30 days are automatically dropped — both at sync time and during
          cleanup. The Bookings page defaults its filter to "checked in within the last 7 days" to
          keep things tidy.
        </div>
      </section>

      {/* ── Step 5: Mapping ───────────────────────────────────────────────── */}
      <section id="map" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">5</span>
          <h2>Map your rooms into GonnaOrder</h2>
        </div>
        <p className="h2-sub">Tell GonnaOrder which Horizon room each of its locations corresponds to.</p>

        <p>
          GonnaOrder needs to know which Horizon room each of <em>its</em> locations (called
          "tables") corresponds to. We do this with the <strong>External Id</strong> field on each
          GonnaOrder location. There are two paths:
        </p>

        <MappingSchematic />
        <p className="schematic-caption">Two flows. Path B is the production-safe one — it never creates duplicates.</p>

        <div className="path-grid">
          <div className="path-card path-a">
            <h4>Path A · Empty test store</h4>
            <p className="path-when">When GonnaOrder doesn't yet have any rooms set up — perfect for a test account.</p>
            <Step n={1}>In <a href="/admin/pull-listings">Listings Sync</a>, expand your store.</Step>
            <Step n={2}>Tick the rooms you want, then click <strong>"Onboard &amp; download create XLSX (N)"</strong>.</Step>
            <Step n={3}>An <code>.xlsx</code> file downloads. In GonnaOrder admin, open <strong>Tables</strong>, click <strong>"Update via Excel"</strong>, and upload the file there.</Step>
            <Step n={4}>Done. GonnaOrder creates one location per Horizon room, with the External Id correctly set.</Step>
          </div>

          <div className="path-card path-b">
            <h4>Path B · Existing rooms (production)</h4>
            <p className="path-when">For real clients where GonnaOrder rooms already exist — fills External Id without creating duplicates.</p>
            <Step n={1}>In GonnaOrder admin, go to <strong>Tables</strong> → <strong>"Update via Excel"</strong> → click the icon next to <em>"Download the Excel file that contains your table data"</em>.</Step>
            <Step n={2}>In Horizon's <a href="/admin/pull-listings">Listings Sync</a>, find your store and click <strong>"Map to GonnaOrder"</strong>.</Step>
            <Step n={3}>Click <strong>"Upload current GonnaOrder export"</strong> and pick the file from step 1.</Step>
            <Step n={4}>Auto-match by name happens; for unmatched rows pick the right Horizon room from the dropdown. Skip rows you don't want to touch.</Step>
            <Step n={5}>Click <strong>"Download mapped XLSX (N)"</strong>.</Step>
            <Step n={6}>Re-upload that file to GonnaOrder via <strong>Tables → Update via Excel</strong>. Each existing room gets its External Id filled in; nothing new is created.</Step>
          </div>
        </div>

        <h3>Path C · Single-room manual paste (no xlsx)</h3>
        <p>
          For one-off rooms — typically <strong>max-pax (Other)</strong> rooms you've added directly
          in Horizon, or quick fixes when you only need to wire up one or two locations. No file
          upload involved.
        </p>
        <Step n={1}>In Horizon, go to <a href="/admin/rooms">Rooms</a>. Find the row you want to map.</Step>
        <Step n={2}>
          In the <strong>Platform ID</strong> column you'll see either the platform_id (for HostHub
          / WebHotelier rooms) or the Horizon UUID (for max-pax rooms). Click the small{' '}
          <code>⧉</code> icon next to it — the value lands on your clipboard and the icon flashes a
          green ✓.
        </Step>
        <Step n={3}>
          (Alternative) Click <strong>Edit</strong> on the row. For max-pax rooms there's a
          dedicated <em>"GonnaOrder External ID"</em> section with a primary <strong>Copy</strong>{' '}
          button.
        </Step>
        <Step n={4}>
          In GonnaOrder admin, open the matching <strong>Tables → location</strong> for that room.
        </Step>
        <Step n={5}>
          Paste the value into the <strong>External Id</strong> field on the GonnaOrder table.
          Save.
        </Step>
        <Step n={6}>
          Repeat for any additional rooms you want to wire up. The validator looks each one up
          identically — there's no difference between the xlsx-mapped rooms and the manually-pasted
          ones once the External Id is in place.
        </Step>

        <div className="callout tip">
          <strong>When to choose Path C over A or B:</strong> Path C is great for max-pax rooms
          (which don't have a platform_id), for one-off corrections after a Path B run, or when you
          have just a handful of rooms and don't want to mess with files. For larger batches the
          xlsx paths are still faster — the Path C steps don't scale past ~10 rooms before xlsx
          starts winning.
        </div>

        <div className="callout warn">
          <strong>Heads-up about the file format:</strong> GonnaOrder is strict about the Table Name
          column — alphanumeric (uppercase letters, digits, dashes), at most 10 characters. Horizon
          generates Table Names automatically from the room's platform ID (e.g.{' '}
          <code>X9C415F73D</code>), so you don't normally need to worry — but if you edit the file
          by hand, keep that rule in mind. (Path C bypasses this entirely — you're only setting
          External Id, not Table Name.)
        </div>
      </section>

      {/* ── Step 6: Webhook ───────────────────────────────────────────────── */}
      <section id="webhook" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">6</span>
          <h2>Wire up GonnaOrder's webhook</h2>
        </div>
        <p className="h2-sub">This is what makes it actually work end-to-end.</p>

        <p>
          You must wire up <strong>two</strong> GonnaOrder integrations here, and{' '}
          <strong>both are required</strong>:
        </p>
        <ul>
          <li>
            <strong>1 · Validation</strong> (before the order): GonnaOrder asks Horizon whether
            breakfast is covered, and Horizon replies yes / no.
          </li>
          <li>
            <strong>2 · Order lifecycle</strong> (after the order): GonnaOrder tells Horizon when an
            order is actually <em>submitted</em>, closed, or cancelled. This is what{' '}
            <strong>consumes</strong> a breakfast slot, so a guest can't keep claiming free
            breakfasts across separate orders and abandoned carts don't hold a slot.{' '}
            <strong>Skip this one and the allowance is never used up.</strong>
          </li>
        </ul>

        <Step n={1}>In GonnaOrder admin, open <strong>Settings → Integrations</strong>.</Step>
        <Step n={2}>Add the <strong>validation</strong> webhook:
          <ul>
            <li><strong>URL:</strong></li>
          </ul>
          <pre><code>https://horizon-app-is.netlify.app/api/validate-breakfast</code></pre>
          <ul>
            <li><strong>Method:</strong> POST &middot; <strong>Content-Type:</strong> application/json</li>
            <li><strong>Trigger:</strong> "Before order is placed" (the exact label varies by GonnaOrder version)</li>
          </ul>
        </Step>
        <Step n={3}>Add the <strong>order-lifecycle</strong> webhook (the one that's easy to forget):
          <ul>
            <li><strong>URL:</strong></li>
          </ul>
          <pre><code>https://horizon-app-is.netlify.app/api/after-order</code></pre>
          <ul>
            <li><strong>Method:</strong> POST &middot; <strong>Content-Type:</strong> application/json</li>
            <li><strong>Trigger:</strong> order events: submitted / closed / cancelled (the "after order" or "order status changed" events; label varies by GonnaOrder version)</li>
          </ul>
        </Step>
        <Step n={4}>Save and test by placing a real order in the store.</Step>

        <div className="callout tip">
          <strong>Confirming both fire:</strong> after a test order, look in Webhook Logs (see step 7).
          You should see a <code>/api/validate-breakfast</code> row as the order is placed, and a{' '}
          <code>/api/after-order</code> row once it's submitted. If only the first appears, the
          order-lifecycle webhook isn't wired and breakfast slots will never be consumed.
        </div>
      </section>

      {/* ── Step 7: Monitor ───────────────────────────────────────────────── */}
      <section id="monitor" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">7</span>
          <h2>Monitor day-to-day</h2>
        </div>
        <p className="h2-sub">The pages you'll glance at regularly once everything is wired.</p>

        <table className="guide-table">
          <thead>
            <tr><th>Page</th><th>What it shows</th><th>When to check</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><a href="/admin/bookings">Bookings</a></td>
              <td>Every reservation we know about. Filter by store, room, date, breakfast-included.</td>
              <td>Each morning to confirm today's check-ins are showing up; before resolving disputes.</td>
            </tr>
            <tr>
              <td><a href="/admin/sync-logs">Sync Logs</a></td>
              <td>Each automated sync run, per room — how many bookings inserted/updated/skipped.</td>
              <td>If something seems off with bookings, check here for failed syncs.</td>
            </tr>
            <tr>
              <td><strong>Webhook Logs</strong> <em>(via DB)</em></td>
              <td>Every call from GonnaOrder, regardless of outcome — payload, response, duration.</td>
              <td>Investigating "why didn't this order pass?" questions.</td>
            </tr>
            <tr>
              <td><strong>Orders</strong> <em>(via DB)</em></td>
              <td>Validated orders that have or will consume breakfast covers.</td>
              <td>To audit how many breakfasts have been served per room per day.</td>
            </tr>
            <tr>
              <td><a href="/admin/settings">Settings</a></td>
              <td>Sync interval, lookback / forward windows.</td>
              <td>Rarely. Defaults are sensible.</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── Troubleshooting ───────────────────────────────────────────────── */}
      <section id="trouble" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">!</span>
          <h2>Troubleshooting</h2>
        </div>
        <p className="h2-sub">Five common failure modes and what to do about them.</p>

        <h3>"Fetch Listings" returns "API key not valid" / 401</h3>
        <ul>
          <li>Check the key is pasted exactly — no leading/trailing space, no missing character.</li>
          <li>For HostHub, the key looks base64-ish but the API expects it that way. Don't decode it.</li>
          <li>Confirm the client hasn't rotated/revoked the key on the HostHub side.</li>
        </ul>

        <h3>An order returns "no_booking_found" but I can see a guest in HostHub</h3>
        <ul>
          <li>Check the booking date range covers the order's wish date (Bookings page → filter by room).</li>
          <li>Confirm the booking is <em>confirmed</em> (not cancelled) and <em>breakfast_included</em>.</li>
          <li>Force-sync the room from the Stores page in case the booking was added/changed after the last sync.</li>
        </ul>

        <h3>An order returns "no_room_match"</h3>
        <ul>
          <li>The External Id GonnaOrder sent doesn't match any Horizon room for this store.</li>
          <li>Re-export the GonnaOrder rooms and re-do step 5 (Path B) to make sure External Ids are filled in.</li>
        </ul>

        <h3>An order returns "exceeds_entitlement" but you think it shouldn't</h3>
        <ul>
          <li>Check the orders table — earlier orders for the same room/date count against the entitlement.</li>
          <li>The entitlement equals the booking's <code>guest_count</code>. If you serve more guests than the booking says, the extras are flagged.</li>
        </ul>

        <h3>The webhook seems silent — no Webhook Logs entries after a real order</h3>
        <ul>
          <li>Confirm the webhook URL on GonnaOrder's side is exactly <code>https://horizon-app-is.netlify.app/api/validate-breakfast</code> — no typos, no trailing slash.</li>
          <li>Check the trigger event — it should fire <em>before</em> the order is placed, not on the receipt.</li>
        </ul>

        <p style={{ marginTop: 24, color: '#475569', fontSize: 14 }}>
          Stuck on something not covered here? Open the row in Webhook Logs for the failing order,
          copy the payload + response, and share them — that's almost always enough to diagnose.
        </p>
      </section>

      {/* ── Per-platform reference ───────────────────────────────────────── */}
      <section id="reference" className="step-section">
        <div className="h2-row">
          <span className="h2-badge">i</span>
          <h2>Per-platform behavior reference</h2>
        </div>
        <p className="h2-sub">How each booking platform reports bookings + flags breakfast.</p>

        <p>
          Every PMS exposes breakfast information differently. This section is the source of truth
          for what Horizon detects automatically vs. what needs a per-store override, what a
          booking has to look like to be considered "active", and any platform-specific quirks.
        </p>

        <h3>HostHub</h3>
        <ul>
          <li><strong>Credentials:</strong> single API key (~48 chars) from <em>HostHub Settings → API Keys</em>.</li>
          <li><strong>Breakfast detection:</strong> per-store keyword allowlist on the booking's free-text <code>meal_plan</code> field. The store's <em>Breakfast — meal-plan keywords</em> setting accepts one keyword per line; a booking is treated as breakfast-included when its <code>meal_plan</code> contains any keyword (case-insensitive substring). <strong>Leave blank for legacy behavior</strong> — every booking is treated as breakfast-included (useful for properties where every rate includes breakfast).</li>
          <li><strong>Active statuses:</strong> HostHub's native confirmed flag.</li>
          <li><strong>Quirks:</strong> none significant.</li>
        </ul>

        <h3>WebHotelier</h3>
        <ul>
          <li><strong>Credentials:</strong> property code (username) + API password.</li>
          <li><strong>Breakfast detection:</strong> OpenTravel-standard board IDs (BB / HB / FB / AI / UAI) auto-detected from the rate plan.</li>
          <li><strong>Active statuses:</strong> WebHotelier native enum.</li>
          <li><strong>⚠️ Important limitation:</strong> WebHotelier's API exposes room <em>categories</em>, not physical units. Each booking attributes to a category — so if a property has multiple physical rooms of the same category, Horizon cannot differentiate which physical room a guest is in. <em>Use a different PMS for properties needing per-physical-room validation.</em></li>
        </ul>

        <h3>RoomRack</h3>
        <ul>
          <li><strong>Credentials:</strong> per-property <em>ApiToken</em> (UUID-shape) from PMS at <em>Setup → Device Interface → General API / Partners API</em>.</li>
          <li><strong>Activation cost:</strong> RoomRack charges <strong>€150 one-time</strong> per property to enable API access. Property pays directly to RoomRack.</li>
          <li><strong>Breakfast detection:</strong> the <code>board</code> field on each reservation. BB / HB / FB / AI prefix matches plus Greek <em>"πρωιν"</em> free-text fallback.</li>
          <li><strong>Active statuses:</strong> <em>Cancelled</em> and <em>No-Show</em> → cancelled; everything else → confirmed.</li>
        </ul>

        <h3>Hotelizer</h3>
        <ul>
          <li><strong>Credentials:</strong> per-property HTTP Basic username + password from Hotelizer.</li>
          <li><strong>Activation cost:</strong> API access is a <strong>separate paid annual subscription</strong> from Hotelizer's standard PMS. Property must email <code>sales@hotelizer.net</code> + <code>support@hotelizer.net</code> to request API access, accept a commercial quote, then Support issues API credentials. <em>User-login credentials from the Hotelizer admin are NOT API credentials — they're separate systems.</em></li>
          <li><strong>Breakfast detection:</strong> <code>board_types.code</code> on each accommodation row — BB / HB / FB / AI / UAI → true; RR / RO / OB / BO / NB / NONE → false. Greek and English free-text fallback also catches "πρωιν" / "breakfast" / "half board" / etc.</li>
          <li><strong>Active statuses:</strong> Cancelled / No-Show → cancelled; everything else → confirmed.</li>
        </ul>

        <h3>Cloudbeds</h3>
        <ul>
          <li><strong>Credentials:</strong> <code>cbat_…</code> API key from <em>Cloudbeds Marketplace → API Credentials → Create API Key</em>, with Integration Type = <strong>Point of Sale</strong>. Property also sends their numeric Property ID. See the dedicated "Cloudbeds stores: walking the property through API key creation" section above for full forwardable steps.</li>
          <li><strong>Breakfast detection:</strong> the reservation's top-level <code>mealPlans</code> field — keyword scan for "breakfast" in any element of the array.</li>
          <li><strong>Active statuses:</strong> Cloudbeds native enum (confirmed / checked-in / checked-out → confirmed; cancelled / no-show → cancelled).</li>
          <li><strong>Quirks:</strong> Cloudbeds rate-plan responses have a nested <code>ratePlan.mealPlans</code> on quotes that we deliberately ignore — only the top-level <code>reservation.mealPlans</code> is the saved-booking signal.</li>
        </ul>

        <h3>Loggia</h3>
        <ul>
          <li><strong>Credentials:</strong> numeric Page ID + API key (sent as <code>x-api-key</code> header). Loggia is part of the Webhotelier family.</li>
          <li><strong>Breakfast detection:</strong> free-text auto-detect on the reservation's <code>rate_name</code>. Catches: <em>breakfast</em>, <em>B&B</em>, <em>bed and breakfast</em>, <em>half board</em>, <em>full board</em>, <em>all incl</em> / <em>all inclusive</em>, the Greek <em>πρωιν</em>, and word-bounded codes BB / HB / FB / AI. <strong>Property must name their breakfast rates with one of these patterns</strong> for auto-detection — e.g. naming a rate "Breakfast Included" works; naming it "First Rate" does not.</li>
          <li><strong>Active statuses:</strong> native enum; cancellation patterns in the status string flip to cancelled.</li>
          <li><strong>Quirks:</strong> short-term-rental focused — most production bookings will be room-only. Per-store ALWAYS/NEVER override available for properties that include breakfast on every booking.</li>
        </ul>

        <h3>Hostaway</h3>
        <ul>
          <li><strong>Credentials:</strong> numeric account_id + API key (from Hostaway dashboard → <em>Get API client secret</em>). Horizon uses OAuth client_credentials to issue a Bearer token cached for 24 months.</li>
          <li><strong>Breakfast detection (4-tier):</strong>
            <ol>
              <li>Per-store ALWAYS / NEVER override wins.</li>
              <li><strong>Listing amenity</strong> (PRIMARY) — at listings-fetch time, Horizon scans Hostaway's amenity catalog and tags listings whose amenity list intersects with the strict breakfast set (<em>Breakfast</em>, id 10 · <em>Meal included</em>, id 319). The ambiguous amenities <em>Breakfast possible</em> (id 218) and <em>Meal delivery</em> (id 278) are deliberately <strong>not</strong> auto-flagged — a property using one of those should set the per-store ALWAYS override.</li>
              <li><strong>Reservation fee name scan</strong> — any fee named <em>"Breakfast"</em> / <em>"meal included"</em> / <em>"πρωιν"</em> flips breakfast on for that specific booking.</li>
              <li><strong>Free-text scan</strong> on host/guest notes, comments, and bookingcomSpecialRequests for the same keywords.</li>
              <li>Default false (vacation-rental baseline).</li>
            </ol>
          </li>
          <li><strong>Active statuses (strict):</strong> only <code>new</code>, <code>modified</code>, and <code>ownerStay</code> → confirmed. Everything else — <code>cancelled</code>, <code>declined</code>, <code>expired</code>, <code>pending</code>, <code>awaiting*</code>, <code>inquiry*</code>, <code>unconfirmed</code>, <code>unknown</code> — → cancelled. A non-null <code>cancellationDate</code> also forces cancelled.</li>
          <li><strong>Quirks:</strong> short-term-rental focused (Airbnb / Booking.com / Vrbo aggregator). Most Airbnb-channel bookings won't carry native breakfast info unless the property explicitly tags their listing with the Breakfast amenity. Multi-unit listings (one Hostaway listing covering multiple physical units) are deferred — Horizon currently treats each Hostaway listing as a single physical unit.</li>
        </ul>

        <h3>"Other" (max-pax — no PMS)</h3>
        <ul>
          <li><strong>Credentials:</strong> none. Rooms are managed manually with a fixed capacity.</li>
          <li><strong>Breakfast detection:</strong> bypassed — every booking is treated as breakfast-included up to the room's max capacity per day. Suitable for properties that always serve breakfast and don't need PMS sync.</li>
          <li><strong>Active statuses:</strong> n/a — there are no bookings synced; validation checks against the max capacity directly.</li>
        </ul>

        <div className="callout tip">
          <strong>Per-store ALWAYS / NEVER overrides</strong> (the <em>Breakfast — meal-plan keywords</em> field, where it appears in the Store form) work the same way across every PMS: set the value to <code>ALWAYS</code> to force breakfast=true on every booking for that store, or <code>NEVER</code> to force false. Use these when a property's PMS doesn't carry breakfast info at all but the property knows their rate mix.
        </div>
      </section>
    </div>
  )
}
