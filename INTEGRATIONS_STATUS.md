# Horizon — Integrations Status

**Single source of truth for every PMS / partner integration. Updated on every meaningful change.**

> **Maintenance rule:** every status change (vendor reply, scope flip, payment received, sandbox provisioned, scaffold pushed, blocker found/cleared) gets reflected here, same session. Per the `horizon-add-integration` skill, this file is part of the "always do, every integration" contract.

**Last updated:** 2026-06-03 — Lodgify reply processed: Myrsini escalated our questions to product team, awaiting their response

---

## At a glance

| Integration | Demo state | Customer-property state | Blocked on | Owner of next move |
|---|---|---|---|---|
| HostHub | n/a (no demo concept) | ✅ Live (31 rooms, 477 bookings/30d) | — | — |
| WebHotelier | n/a | 🟡 Code ready, no customer yet | First real customer | (passive) |
| RoomRack | ✅ Demo live (1 room #111, 1,969 syncs/7d, 100% success) | 🟡 **BLOCKED: Finders Hospitality awaiting €150 activation invoice** | Sending RoomRack billing email + paying the €150 fee | **You** (decide invoice email + pay) |
| Hotelizer | ✅ Demo live (1 room #307, 1,960 syncs/7d, 100% success) | 🟡 **BLOCKED: Lasari Comfort Living awaiting Hotelizer API-scope activation** | Hotelizer support flipping `/api/integrations/*` scope for `LASARI` account | Hotelizer support (~1 business day) |
| HIT / Protel | n/a (push model, no demo) | 🟡 Receiver live + authed, awaiting vendor commercial OK + push activation | HIT commercial OK | HIT (unknown timeline) |
| Cloudbeds | 🟢 **Live on main**, verified end-to-end against sandbox (commit `82f1ba6` + bookings_provider_check migration). Sandbox test data cleaned up. | 🟢 Ready for first real property | Wait for first Cloudbeds property to onboard — at that point: create store, fetch listings, onboard rooms via the Horizon admin UI | (passive — vendor side ready) |
| Lodgify | n/a | 🟡 Myrsini acknowledged 2026-05-28; forwarded our 2 questions (meal-plan mapping + API key generation) to Lodgify product team — awaiting their response | Wait. Optional gentle nudge ~2026-06-06 if silence continues. | Lodgify product team |
| Guesty | n/a | 🟡 Reply sent today to Karazeris for forwarding | Karazeris forwarding + Guesty integrations reply | Karazeris → Guesty |
| **Loggia** | ✅ **Demo creds + API key + Postman collection received 2026-05-31** | 🟡 Not yet built | Us — read docs, scaffold provider, hit demo with the issued creds | **Us** (no vendor blocker; this one is ready to build) |
| **Orange PMS (Marinet)** | n/a | 🟡 API docs URL provided 2026-05-28; vendor said properties should contact them to proceed | Read the docs at https://hotel.orangepms.com/api.html, draft reply (English/Greek) to Aspasia confirming next steps | **Us** (reply to Aspasia) → then property-side coordination |
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

### Cloudbeds — 🟢 Sandbox key live + smoke-tested, ready to wire up

- **2026-05-29:** Triphol Nilkuha re-routed us from MyAllocator/OTA to the correct **Marketplace Partner sandbox** and provisioned a Partner account.
- **2026-06-02 evening (this session):** We logged in via the Okta activation link, configured the partner app (Email delivery, 8 read scopes, `ioustinos@wecook.gr` as notification address), then used the Quickstart self-service path (Account → Apps & Marketplace → API Credentials → New Credentials → Create API Key) to issue a property-level API key for the sandbox property.
- **Sandbox API key issued:** `cbat_hDj1j1uhDuQj9uuVXRcdv23hHpiSBCmT` (saved locally in `.cloudbeds-sandbox-credentials.md`, gitignored)
- **Sandbox property:** ID `320653` ("The-Horizon Partner Account"), USD, UTC timezone, pre-populated with dummy data
- **Scopes granted:** `read:addon read:customFields read:guest read:hotel read:package read:rate read:reservation read:room offline_access`
- **Smoke test (2026-06-02 21:43 UTC):** `curl -H "Authorization: Bearer cbat_…" -H "X-PROPERTY-ID: 320653" https://hotels.cloudbeds.com/api/v1.3/getHotels` returned `HTTP 200`, `success: true`, sandbox property data. **Auth confirmed working against the v1.3 base URL.**
- **Next action — us:**
  1. Verify the `cloudbeds-scaffold` branch parser against real `getReservationsWithRateDetails` and `getRooms` payloads
  2. Apply DB migration (`migrations/2026_05_27_add_cloudbeds_platform.sql`) to add `'cloudbeds'` to the rooms.platform + stores.platform CHECK constraints
  3. Add UI exposure (7 frontend files per the runbook)
  4. Merge `cloudbeds-scaffold` → `main`
  5. Create a "Cloudbeds Sandbox" store in Horizon admin with `api_key_name=320653`, `api_key_secret=cbat_hDj1j1uhDuQj9uuVXRcdv23hHpiSBCmT`
  6. Fetch listings → onboard a test room → force sync → run the four validation scenarios
- **Scaffold:** `cloudbeds-scaffold` branch (commit `980cd52`) — provider + dispatchers + DB migration, no UI exposure yet. Estimated ~1 hour of dev work to verify parser + merge + onboard test room.

### Lodgify — 🟡 Myrsini acknowledged 2026-05-28, our 2 questions escalated to Lodgify product team

- We replied to Myrsini Pappa 2026-05-27 with full project overview + 2 questions (breakfast detection mechanism, where to generate X-ApiKey + sandbox availability)
- **Myrsini replied 2026-05-28** (full text now read via Gmail web on 2026-06-03):
  - *"Thank you for reaching out and for providing such a detailed overview…"*
  - *"I have forwarded your queries regarding the meal-plan field mapping and the API key generation process to our product team for further clarification. I will keep you updated as soon as I receive a response from them."*
- **Status:** acknowledgment only — no technical info to act on. She's the relay; substantive answer comes from Lodgify product team via her.
- **No action required from us today.** Optional polite follow-up after 2-3 more days of silence (~2026-06-06) if she hasn't circled back.
- **Scaffold:** `lodgify-scaffold` branch (commit `fc1ab26`) — provider + dispatchers + DB migration, no UI exposure yet. Stays parked until we get the product team's answers (specifically: how meal-plan / breakfast is exposed on `/v2/reservations/bookings` since the field isn't on the standard booking shape, and whether sandbox credentials are available).

### Guesty — 🟡 Reply sent to Karazeris today, awaiting forwarding + vendor reply

- 2026-06-02: Sent the English reply for Karazeris to forward to the Guesty integrations contact (`guesty-reply-karazeris.md`). Reply includes:
  - Full Horizon overview
  - Cited endpoints we'll use (`POST /oauth2/token`, `GET /v1/reservations`, `GET /v1/listings`)
  - Verified-finding: `ratePlan.mealPlans` is NOT on the saved reservation (only on quote responses); primary signal will be listing-level `breakfast` amenity instead
  - Explicit demo / sandbox account request
- **Next action — Karazeris forwards, then Guesty integrations contact replies.**
- **Scaffold:** `guesty-scaffold` branch (commit `4488779`) — provider + dispatchers + DB migration, no UI exposure yet. Updated commit (`674e481`) switched breakfast detection to listing-amenity instead of `ratePlan.mealPlans` based on the deep-docs walk earlier today.

### Loggia — ✅ Demo creds received 2026-05-31, ready to build

- Email from Eutychis Vavourakis (`Ευτύχης Βαβουράκης`), 2026-05-31 — forwarded by `info@the-horizon.gr` to `ioustinos@wecook.gr` with subject *"Fw: Πρόσβαση σε Loggia API"*
- **Demo credentials issued:**
  - Username: `info@the-horizon.gr`
  - Password: `2gb0zPOoenVn`
  - API key: `88TOcJUc0DYF5fLEE25HHnl73PZ7fwxkVE3RWz9BwzjBl5nsS4`
  - Page id: `4634`
  - Loggia demo PMS available for testing
- **Attachment:** `loggia-properties-api.postman.json` — a Postman collection with example API calls. Major time-saver: we don't need to guess at endpoint shapes, paths, or auth headers.
- **Status:** unblocked from vendor side; entirely on us to build. Per the new skill's deep-docs-walkthrough rule, the next step is to walk the Postman collection (which functions as the authoritative endpoint reference), then scaffold `providers/loggia.js` following the Cloudbeds/Lodgify/Guesty pattern on a `loggia-scaffold` branch.
- **Earlier mention:** there was a 2026-05-06 thread with `support@loggia.net` (ticket-receipt for request #20789, sent to `dev@webhotelier.net` with hotelizer + horizon CC'd). Appears to be unrelated to this integration request — more likely a WebHotelier-related ticket that happened to CC Loggia support. Worth confirming when we next touch this thread.
- **Next action — us:** walk the Postman collection + docs, build scaffold, smoke-test the demo creds end-to-end before any real property goes live (per the always-request-demo rule, we already have them — just need to use them).

### Orange PMS (Marinet) — 🟡 API docs URL received 2026-05-28, awaiting our reply

- Thread between Karazeris and Aspasia Polymerou (`apolymerou@marinet.gr`, Head of Tech & Customer Support at Marinet Ltd, Piraeus). Sequence:
  - **2026-05-27 10:52** — Karazeris emailed Marinet introducing Horizon + asking about API integration with the exact data needs (check-in/out dates, breakfast inclusion, guest count, room number, basic reservation info)
  - **2026-05-27 11:28** — Aspasia replied: tech team will be informed and will reach back
  - **2026-05-28 12:25** — Aspasia replied with **API docs URL: `https://hotel.orangepms.com/api.html`** and noted that interested properties should contact Marinet directly to proceed
  - **2026-05-28 13:01** — Karazeris forwarded the thread to `ioustinos@wecook.gr` for technical follow-up
- **Status:** API docs link in hand; haven't walked them yet. No demo credentials yet — per the always-request-demo rule, when we reply we explicitly ask for a sandbox.
- **Reply not yet drafted.** Karazeris is the property contact; we (Horizon, via `ioustinos@wecook.gr`) are the technical contact going forward (Aspasia's reply was forwarded to us specifically).
- **Next action — us:**
  1. Walk `https://hotel.orangepms.com/api.html` end-to-end per the skill (grep checklist: auth, getReservations equivalent, listings, breakfast/meal field, rate limits, sandbox)
  2. Draft reply to Aspasia (English or Greek — TBD; vendor wrote in Greek so probably Greek) with: Horizon overview, endpoints we'll use (cited), breakfast-detection assumption (cited), demo / sandbox credentials request, and confirmation of who owns the technical contact going forward
  3. Scaffold `providers/orange.js` on a `orange-scaffold` branch following the Cloudbeds/Lodgify/Guesty pattern

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
| 2026-05-27 | Aspasia Polymerou (`apolymerou@marinet.gr`) | Orange PMS integration scoping (initial from Karazeris) | ✅ Sent (Karazeris). Aspasia replied 2026-05-28 with docs URL. **Our follow-up reply not yet drafted.** |
| TBD | Aspasia Polymerou | Orange PMS — Horizon technical reply + sandbox request | 🟡 Pending; draft after walking the docs |
| 2026-05-31 | (Eutychis Vavourakis / Loggia) | Loggia issued demo creds + Postman collection | ✅ Received. No reply needed yet — we just need to build. |

---

## Branches awaiting credentials / merge

- `cloudbeds-scaffold` — commit `980cd52` — unblocks once Cloudbeds sandbox login is done
- `lodgify-scaffold` — commit `fc1ab26` — unblocks once Myrsini's reply is processed
- `guesty-scaffold` — commit `4488779` (+ `674e481` for the breakfast-detection fix) — unblocks once Guesty demo creds arrive
- *(not yet created)* `loggia-scaffold` — to build next; demo creds + Postman collection in hand
- *(not yet created)* `orange-scaffold` — pending docs walk + reply to Aspasia + sandbox credentials

---

## Update log

- **2026-06-02 evening (initial):** File created. RoomRack status corrected (was previously "live healthy" — actually demo is healthy, but Finders Hospitality customer is blocked on €150 activation fee). Cloudbeds status escalated to "action required from us" (Partner sandbox provisioned 2026-05-29, auto-close threat from today's reminder). Lodgify status updated (Myrsini reply received 2026-05-28, full content still to be processed). Hotelizer/Lasari status reflects today's support email send. Guesty status reflects today's reply send.
- **2026-06-02 evening (+30m):** Added **Loggia** (Eutychis Vavourakis sent demo creds + API key + Postman collection on 2026-05-31 — ready to build; no vendor blocker, just our turn) and **Orange PMS / Marinet** (Aspasia Polymerou sent API docs URL `https://hotel.orangepms.com/api.html` on 2026-05-28 — we owe a technical reply + sandbox request after walking the docs).
- **2026-06-02 21:43 UTC:** **Cloudbeds sandbox key issued + smoke-tested.** Partner app configured (Email delivery, 8 read scopes), then Quickstart property-level credentials flow used to mint `cbat_hDj1j1uhDuQj9uuVXRcdv23hHpiSBCmT` for sandbox property 320653. Curl to `/api/v1.3/getHotels` returned HTTP 200 + sandbox property data — auth verified, v1.3 base URL confirmed, X-PROPERTY-ID header accepted.
- **2026-06-02 22:00 UTC:** **Cloudbeds parser verified against real payloads + patched.** Curls to `/getRooms` (returned 30 physical rooms, e.g. `DQ(1)..DK(9)`) and `/getReservationsWithRateDetails` (returned reservations with two-room bookings, mealPlans empty in sandbox). Found field-name mismatches in our scaffold: actual fields are `reservationCheckIn`/`reservationCheckOut` (not `checkIn`), `rooms[].adults`/`children` as strings (not numbers on the reservation), `rateName`/`ratePlanNamePublic`/`ratePlanNamePrivate` (not `ratePlanName`). Top-level `reservation.mealPlans` IS persisted (correction of earlier "not present" finding which was about the different nested `ratePlan.mealPlans` quote-only field). Patched in commit `8796b35`.
- **2026-06-02 22:09 UTC:** **Cloudbeds merged to `main` (commit `82f1ba6`).** DB migration applied (CHECK constraints include `'cloudbeds'`), 8 frontend files updated (Rooms/Bookings/SyncLogs/Stores/StoreForm/RoomForm/PullListings/Guide). Sandbox store created via SQL: id `a7a24f44-b538-4a7d-934b-fbb0cd0b5421`, name "Cloudbeds Sandbox", `api_key_name=320653`, `api_key_secret=cbat_hDj1…`. Listings fetch + room onboarding + sync verification in flight.
- **2026-06-02 22:15 UTC:** First force-sync errored on `bookings_provider_check`. The earlier migration covered `rooms.platform` + `stores.platform` but missed `bookings.provider` — partial DDL. Applied the missing constraint via second `apply_migration`. Skill SKILL.md strengthened to bundle all three constraints (rooms / stores / bookings) into a single SQL block so the half-execute mistake is structurally impossible next time. Updated `.skill` packaged.
- **2026-06-02 22:20 UTC:** **Cloudbeds end-to-end verified.** `/api/fetch-listings` returned 20 sandbox rooms with correct parser output (DQ(1..10) + DK(1..10), capacity 2). `/api/force-sync` for room DK(8) returned `{fetched:3, inserted:3, updated:0, deleted:0}`. Spot-checked the 3 bookings in `bookings` table: external_id/check_in/check_out/guest_count/status/raw_data all match source. `breakfast_included = false` for all three — correct, since raw `mealPlans = ""` in sandbox dummy data (the keyword detector flips to true when a real property sets `mealPlans = "breakfast"`).
- **2026-06-02 22:25 UTC:** Cleaned up sandbox test data: 3 bookings, 2 sync_logs, 1 room (DK(8)), 1 store (Cloudbeds Sandbox) deleted. Zero orphans. Infrastructure (provider code, DB constraints, UI exposure, scaffold branches, sandbox API key in gitignored workspace file) all retained.
- **2026-06-03:** Read Myrsini's Lodgify reply in full (via Gmail web — get_thread response too large for inline fetch). Three sentences: acknowledgment + confirmation that both our questions (meal-plan field mapping + API key generation process) have been forwarded to the Lodgify product team. No technical content yet — pure relay. No action needed from us today; optional gentle nudge in 2-3 days if no follow-up.
