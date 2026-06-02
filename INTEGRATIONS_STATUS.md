# Horizon — Integrations Status

**Single source of truth for every PMS / partner integration. Updated on every meaningful change.**

> **Maintenance rule:** every status change (vendor reply, scope flip, payment received, sandbox provisioned, scaffold pushed, blocker found/cleared) gets reflected here, same session. Per the `horizon-add-integration` skill, this file is part of the "always do, every integration" contract.

**Last updated:** 2026-06-02 evening UTC

---

## At a glance

| Integration | Demo state | Customer-property state | Blocked on | Owner of next move |
|---|---|---|---|---|
| HostHub | n/a (no demo concept) | ✅ Live (31 rooms, 477 bookings/30d) | — | — |
| WebHotelier | n/a | 🟡 Code ready, no customer yet | First real customer | (passive) |
| RoomRack | ✅ Demo live (1 room #111, 1,969 syncs/7d, 100% success) | 🟡 **BLOCKED: Finders Hospitality awaiting €150 activation invoice** | Sending RoomRack billing email + paying the €150 fee | **You** (decide invoice email + pay) |
| Hotelizer | ✅ Demo live (1 room #307, 1,960 syncs/7d, 100% success) | 🟡 **BLOCKED: Lasari Comfort Living awaiting Hotelizer API-scope activation** | Hotelizer support flipping `/api/integrations/*` scope for `LASARI` account | Hotelizer support (~1 business day) |
| HIT / Protel | n/a (push model, no demo) | 🟡 Receiver live + authed, awaiting vendor commercial OK + push activation | HIT commercial OK | HIT (unknown timeline) |
| Cloudbeds | n/a (Partner sandbox provisioned 2026-05-29) | 🟡 **ACTION REQUIRED FROM US** | Logging into the Okta-provisioned sandbox, clicking through app setup | **You** (Cloudbeds will auto-close ticket in 5 days from 2026-06-02) |
| Lodgify | n/a | 🟡 Myrsini replied 2026-05-28; full reply not yet processed | Reading her reply + acting on next step | **You / Me** (someone needs to read it end-to-end) |
| Guesty | n/a | 🟡 Reply sent today to Karazeris for forwarding | Karazeris forwarding + Guesty integrations reply | Karazeris → Guesty |
| Other (max-pax, no PMS) | n/a | ✅ Live, heavy production use (230 rooms, all GonnaOrder traffic this week landed here) | — | — |

---

## Production health (last 7 days)

| Endpoint | Hits | Errors | Last hit |
|---|---|---|---|
| `/api/validate-breakfast` | 252 | 0 | active |
| `/api/after-order` (ORDER_SUBMITTED consume) | 1,363 | 1 | active |
| `/api/hit-webhook` | 6 (smoke tests only) | 0 | 2026-05-27 |

---

## Detailed status per integration

### HostHub — ✅ Live, no action

- 31 rooms, 477 bookings synced in the last 30 days
- 38,821 / 38,826 sync success in the last 7 days (~99.99%)
- Last successful sync: 2026-06-02 20:47 UTC
- The 5 failures are transient `fetch failed` errors that auto-recover on the next cron tick

### WebHotelier — 🟡 Wired, no customer

- Code path is in production (`providers/webhotelier.js`), tested March-April 2026 with WebHotelier's `dev@` team
- No real WebHotelier customer onboarded in Horizon yet
- Limitation memorialised: WebHotelier API exposes room CATEGORIES only, not physical units — affects what kind of property can use Horizon via WebHotelier
- **Next action:** none on our side; wait for a property to surface

### RoomRack — 🟡 Demo live, customer blocked on €150 fee

- **Demo store** (`pms.abouthotelier.com`, token `e91fb7ff...`, login `Horizon`/`Horizon`): 1 room (#111), 16 bookings/30d, 1,969/1,970 sync success in 7d, last success 2026-06-02 20:47 UTC.
- **Real customer (Finders Hospitality, CEO Irene Panagopoulou):** NOT yet onboarded. RoomRack support email (2026-05-20, from `support@roomrack.gr`) confirmed:
  - Demo token was issued (already wired in)
  - **Activation cost for the customer property is €150**
  - Roomrack support is waiting for "ποιο e-mail να αποστείλουμε την αντίστοιχη χρέωση" — i.e. which email to send the invoice to
- **Next action — YOU:**
  1. Reply to RoomRack support with the email address to send the €150 invoice to
  2. Pay the invoice when it arrives
  3. They activate the customer property; we then onboard it in Horizon admin
- **Reference email:** Subject *"Fw: Γεφύρωση Horizon Breakfast με Finders Hospitality"*, 2026-05-22 in your inbox

### Hotelizer — 🟡 Demo live, Lasari customer blocked on scope flip

- **Demo store** (`username`/`pass` per Hotelizer Guidelines page): 1 room (#307), 26 bookings/30d, 1,960/1,960 sync success in 7d, last success 2026-06-02 20:47 UTC. Verified independently today by curl from your terminal (HTTP 200, 30 rooms returned).
- **Real customer (Lasari Comfort Living):** NOT yet onboarded. Credentials provided (`LASARI` / 40-char hex) but Hotelizer returns HTTP 401 `UnauthorizedError: "You are not allowed to access this information!"` on `/api/integrations/rooms`. All three auth methods (Basic, Bearer, URL-param) reject the same way. Verified our side is clean: same code path that runs the Demo store (1,960 successes/7d) is the one Lasari uses.
- **Diagnosis:** the credentials authenticate but the `/api/integrations/*` scope is OFF for the Lasari account on Hotelizer's side. Confirmed by walking the Hotelizer admin manual (no self-serve API toggle exists) and the API docs (no documented activation path; only contact is `dev@hotelizer.net`).
- **Next action — Hotelizer support (we've handed off):**
  - 2026-06-02: Sent support email to `dev@hotelizer.net` asking them to enable the `/api/integrations/*` scope for username `LASARI` (the `hotelizer-lasari-support-email.md` draft)
  - 2026-06-02: Sent owner-update via Karazeris to the Lasari property contacts so they know what's happening
- **ETA:** typically 1 business day for Hotelizer to flip the scope. Once flipped, click "Fetch Listings" in Horizon admin → onboard rooms → done.

### HIT / Protel — 🟡 Receiver live, awaiting vendor commercial OK + activation

- Push-based PMS (unlike all others which are pull-based)
- Capture-mode webhook receiver live at `https://horizon-app-is.netlify.app/api/hit-webhook`, authenticated via `HIT_WEBHOOK_TOKEN` env var (Bearer token model). 0 real HIT pings received yet; only 6 smoke tests from 2026-05-27.
- IP allowlist support deployed (commit `afb59b5`, env var `HIT_WEBHOOK_IP_ALLOWLIST`, dormant) — can be turned on later if we want to lock to HIT's egress IPs
- Last vendor message: 2026-05-27 from Triphol Tsekouras (Project Manager). We replied 2026-05-27 with credentials + webhook URL.
- **Next action — HIT (we've handed off):** waiting on commercial team OK + activation of push from their side. They quoted "εντός 2 ημερών" (within 2 days) from activation, but commercial OK is the gate.

### Cloudbeds — 🟢 Partner sandbox PROVISIONED, action required from us

- **Major update from 2026-05-29:** Triphol Nilkuha (Senior API Onboarding Manager, Cloudbeds) re-routed us from MyAllocator/OTA to the correct **Marketplace Partner sandbox**, and **created a Partner sandbox account for us** — pre-populated with dummy data for testing.
- Setup details from his email:
  - Password setup via Okta — welcome email landed in our inbox 2026-05-29 (`noreply@okta.com`, *"You're in! Welcome to Cloudbeds!"*)
  - App setup URL: `https://hotels.cloudbeds.com/connect/320653#/app_details`
  - Tips: configure redirect URI for Automatic Delivery (or email delivery for new-property notifications), follow Quickstart Guide for auth, edit Administrator role permissions
  - Pre-condition for Certification: confirm Connectivity Agreement is in place with Partnerships Manager
- **Today (2026-06-02): 2 "ACTION REQUIRED" reminder emails from Cloudbeds** — they'll auto-close the ticket in 5 days from today (≈ 2026-06-07) if we don't respond.
- **Next action — YOU (or me with your guidance):**
  1. Find the Okta welcome email + 2026-05-29 Triphol email
  2. Set password via `https://hotels.cloudbeds.com/auth/login` (or Forgot Password)
  3. Log in, visit `https://hotels.cloudbeds.com/connect/320653#/app_details`, set up the app (decide Automatic vs Email Delivery, set redirect URI if Automatic)
  4. Tell me when done — I can then verify the `cloudbeds-scaffold` branch parser against the sandbox's dummy data, merge to main, and we're production-ready for the first real Cloudbeds property
- **Scaffold:** `cloudbeds-scaffold` branch (commit `980cd52`) — provider + dispatchers + DB migration, no UI exposure yet

### Lodgify — 🟢 Reply received from Myrsini 2026-05-28, awaiting parse

- We replied to Myrsini Pappa 2026-05-27 with full project overview + 2 questions (breakfast detection mechanism, where to generate X-ApiKey)
- **Myrsini replied 2026-05-28** with positive opening: *"Thank you for reaching out and for providing such a detailed overview of your project and your specific technical questions regarding the Lodgify API integration for Horizon. I have..."*
- **Full reply content not yet processed end-to-end** — the email thread is too large for the email tool to return in one call. **Action: read the full reply in Gmail and either paste it here, or I'll attempt a chunked re-fetch next session.**
- **Scaffold:** `lodgify-scaffold` branch (commit `fc1ab26`) — provider + dispatchers + DB migration, no UI exposure yet

### Guesty — 🟡 Reply sent to Karazeris today, awaiting forwarding + vendor reply

- 2026-06-02: Sent the English reply for Karazeris to forward to the Guesty integrations contact (`guesty-reply-karazeris.md`). Reply includes:
  - Full Horizon overview
  - Cited endpoints we'll use (`POST /oauth2/token`, `GET /v1/reservations`, `GET /v1/listings`)
  - Verified-finding: `ratePlan.mealPlans` is NOT on the saved reservation (only on quote responses); primary signal will be listing-level `breakfast` amenity instead
  - Explicit demo / sandbox account request
- **Next action — Karazeris forwards, then Guesty integrations contact replies.**
- **Scaffold:** `guesty-scaffold` branch (commit `4488779`) — provider + dispatchers + DB migration, no UI exposure yet. Updated commit (`674e481`) switched breakfast detection to listing-amenity instead of `ratePlan.mealPlans` based on the deep-docs walk earlier today.

### Other (max-pax, no PMS) — ✅ Heavy production use, no action

- 230 rooms configured with manual max-pax capacity (no PMS integration)
- All 252 `/api/validate-breakfast` hits this week landed on these rooms
- Working as designed; the bulk of customer traffic Horizon serves today

---

## Outbound email queue (sent vs. still to send)

| Date | To | Re | Status |
|---|---|---|---|
| 2026-05-27 | `dtsekouras@hit.com.gr` | HIT credentials + webhook URL | ✅ Sent |
| 2026-05-27 | `myrsini.pappa@lodgify.com` | Lodgify scoping reply | ✅ Sent (she replied 2026-05-28) |
| 2026-05-27 | `integrations@cloudbeds.com` (via Karazeris) | Cloudbeds re-routing request | ✅ Sent (Triphol replied 2026-05-29 with sandbox) |
| 2026-06-02 | `dev@hotelizer.net` (via Karazeris) | Lasari API scope enable request | ✅ Sent |
| 2026-06-02 | Lasari property contacts (via Karazeris) | Owner update on the API scope situation | ✅ Sent |
| 2026-06-02 | Guesty integrations (via Karazeris) | Full Guesty scoping reply | ✅ Sent to Karazeris; awaiting his forward |

---

## Branches awaiting credentials / merge

- `cloudbeds-scaffold` — commit `980cd52` — unblocks once Cloudbeds sandbox login is done
- `lodgify-scaffold` — commit `fc1ab26` — unblocks once Myrsini's reply is processed
- `guesty-scaffold` — commit `4488779` (+ `674e481` for the breakfast-detection fix) — unblocks once Guesty demo creds arrive

---

## Update log

- **2026-06-02 evening:** File created. RoomRack status corrected (was previously "live healthy" — actually demo is healthy, but Finders Hospitality customer is blocked on €150 activation fee). Cloudbeds status escalated to "action required from us" (Partner sandbox provisioned 2026-05-29, auto-close threat from today's reminder). Lodgify status updated (Myrsini reply received 2026-05-28, full content still to be processed). Hotelizer/Lasari status reflects today's support email send. Guesty status reflects today's reply send.
