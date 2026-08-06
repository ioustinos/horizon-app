# Horizon — Context for Claude

## What This App Does
Breakfast entitlement validator. Syncs hotel bookings from HostHub, WebHotelier, RoomRack, Hotelizer, Cloudbeds, Loggia, Hostaway, Orange PMS, and Lodgify APIs into Supabase. GonnaOrder calls our validation endpoint to check if breakfast is included for a specific booking.

## Stack
- Frontend: React + Vite
- Backend: Netlify Functions (Node.js serverless)
- Database: Supabase (PostgreSQL)
- GitHub: github.com/ioustinos/horizon-app (branch: main)
- Live URL: https://horizon-app-is.netlify.app
- Netlify Site ID: 8c3deac3-e209-415d-a786-8ad6f4c8aefa
- Deploys: Automatic on every push to main

## Git Workflow — CRITICAL (read before any git command)

**Never run git from the workspace folder.** The Cowork session mounts the workspace
via FUSE, which blocks `unlink()` on `.git/index.lock`, `.git/objects/pack/tmp_*`,
etc. Once those files appear (any interrupted git op leaves them behind) the lock
is permanent — `rm` fails, no future git command can complete in that worktree,
and every subsequent session inherits the broken state.

**The fix: clone fresh into `/tmp/` and use `GIT_DIR` + `GIT_WORK_TREE`** so the
workspace is the worktree but `.git` lives on a normal Linux filesystem. The PAT
is already embedded in `remote.origin.url` of the workspace `.git` — use it to
clone without re-authing.

```bash
# Read the PAT from the existing workspace remote (no extra credentials needed)
REMOTE=$(GIT_DIR=/sessions/<session>/mnt/Horizon/.git git config --get remote.origin.url)

# Fresh clone into /tmp with a NEW path (old /tmp/horizon-pushN may be stale).
PUSH_DIR=/tmp/horizon-pushN          # bump N every new session
rm -rf "$PUSH_DIR"
git clone --depth 50 -b main "$REMOTE" "$PUSH_DIR"
cd "$PUSH_DIR"
git config user.email "ioustinos.sarris@gmail.com"
git config user.name "ioustinos"
git config --global --add safe.directory "$PUSH_DIR"

# Make edits inside $PUSH_DIR (NOT the workspace), then commit + push from $PUSH_DIR.
# Or, if you want to edit via the host file tools (Read/Write/Edit), edit files in
# the workspace and then mirror them into $PUSH_DIR with cp before committing.

git add path/to/specific/file.jsx    # always specific files — never `git add -A`
git commit -m "concise, present-tense message"
git push origin main                  # auto-deploys via Netlify
```

**Rules**
- Never `cd /sessions/<session>/mnt/Horizon` and run `git`. Read-only `git log` /
  `git show` against `GIT_DIR=...workspace/.git` is fine; anything that writes
  (`fetch`, `pull`, `add`, `commit`, `stash`) will eventually corrupt the index.
- Always use `git add <specific paths>`, never `git add -A`, so untracked
  workspace artifacts (`*.docx`, scratch files, etc.) don't sneak into commits.
- Bump the push-dir name each session (`/tmp/horizon-push1`, `/tmp/horizon-push2`,
  …) — `rm -rf` may fail on dirs left by a prior session.
- **Always pull first** by re-cloning fresh — that's the whole point of this
  pattern. Don't try to reuse a stale `/tmp/horizon-pushN` from a previous chat.
- The workspace folder will go out of sync with `origin/main` over time. That's
  expected. The `/tmp/horizon-pushN` clone is the source of truth for git ops.

## Repo Structure
```
├── netlify/functions/
│   ├── validate-breakfast.js   # GonnaOrder validation endpoint (POST)
│   ├── sync-bookings.js        # Cron entry + dispatcher → providers/*.js
│   ├── force-sync.js           # Manual per-room sync trigger (re-uses syncRoom)
│   ├── fetch-listings.js       # Listings entry + dispatcher → providers/*.js
│   ├── after-order.js          # GonnaOrder lifecycle webhook (consume on ORDER_SUBMITTED)
│   ├── hit-webhook.js          # HIT DataExchange push receiver (capture-only scaffold)
│   ├── test-hosthub.js         # Diagnostic: test HostHub API auth
│   ├── guest-messaging-background.js # Hourly scheduled sweep: WhatsApp reminders + review requests
│   ├── force-messaging.js      # Manual sweep trigger (x-messaging-key header guard)
│   ├── whatsapp-inbound.js     # Twilio inbound webhook: ratings, STOP, free-text feedback
│   ├── whatsapp-status.js      # Twilio status callbacks + SMS fallback on failed reminders
│   ├── messaging/              # Guest-messaging internals (not exposed as functions)
│   │   ├── _shared.js          # Twilio REST via fetch, signature validation, phone/time helpers
│   │   └── engine.js           # Audience selection: simple+stop reminder rule, review requests
│   └── providers/              # One file per booking platform
│       ├── _shared.js          # supabase + upsertBookings/log helpers
│       ├── hosthub.js          # HostHub sync + listings
│       ├── webhotelier.js      # WebHotelier sync + listings
│       ├── roomrack.js         # RoomRack sync + listings
│       └── hotelizer.js        # Hotelizer sync + listings
├── src/
│   ├── pages/
│   │   ├── Rooms.jsx           # Room management (was Facilities)
│   │   ├── Bookings.jsx        # Booking viewer
│   │   ├── SyncLogs.jsx        # Sync history
│   │   ├── PullListings.jsx    # Onboard listings from platforms
│   │   ├── TestWebhook.jsx     # Test validation endpoint
│   │   ├── GuestMessages.jsx   # WhatsApp/SMS message log (incl. dry-run preview)
│   │   ├── Reviews.jsx         # Breakfast ratings + private feedback
│   │   ├── Stores.jsx          # Store management
│   │   ├── Settings.jsx        # App settings
│   │   ├── AdminLayout.jsx     # Sidebar + layout
│   │   └── Login.jsx           # Auth
│   ├── components/
│   │   ├── RoomForm.jsx        # Room create/edit modal (was FacilityForm)
│   │   ├── StoreForm.jsx       # Store create/edit modal
│   │   └── ProtectedRoute.jsx  # Auth guard
│   ├── contexts/AuthContext.jsx
│   ├── supabase.js
│   ├── App.jsx
│   └── index.css
├── docs/
│   ├── twilio-whatsapp-setup-guide.md   # Full manual setup guide (Twilio account → templates)
│   └── whatsapp-messaging-handoff.md    # Decisions + findings from the 2026-08-06 planning session
├── netlify.toml
├── package.json
└── vite.config.js
```

## Key API Details

### HostHub
- Production base URL: https://app.hosthub.com/api/2019-03-01
- Auth header: `Authorization: <api_key_secret>` (raw key, no scheme prefix)
- Key endpoints: /rentals, /rentals/{id}/calendar-events
- Per-store creds: `api_key_secret` on the linked `stores` row
- Breakfast detection: per-store keyword allowlist on `meal_plan` (substring, case-insensitive). Empty allowlist = backwards-compat "all bookings include breakfast".

### WebHotelier
- Base URL: https://rest.reserve-online.net (Reserve-Online REST API)
- Auth: HTTP Basic — `api_key_name` (property code/username) + `api_key_secret` (password)
- Key endpoints: /reservation (booking search), /room/{propertycode} (listings)
- `room.platform_id` = WebHotelier room CODE (e.g. DBL, TRP) — used to filter the unfiltered booking response
- Breakfast detection: OpenTravel-standard board IDs (`BREAKFAST_BOARD_IDS` set in `providers/webhotelier.js`)

### RoomRack
- Base URL: https://pms.abouthotelier.com/api/RoomRackAPI
- Auth: `?ApiToken={api_key_secret}` query param (NOT a header). Token is per-property — store enables it in RoomRack PMS at Setup → Device Interface.
- `api_key_name` is unused for RoomRack
- Key endpoints: GetReservations, GetAllRooms, GetRoomTypes, GetBookingChannels
- `room.platform_id` = RoomRack room number (matches the `room_number` field). Pushed server-side via the `RoomNumber=` filter to keep responses small.
- Date formats: query takes `dd-MM-yyyy`; response returns `dd/MM/yyyy HH:mm`. Provider parses both.
- Breakfast detection: read directly from each reservation's `board` field (BB/HB/FB/AI prefixes → true; RO/OB → false; Greek/English keyword fallback for free-text). No per-store config needed.
- 190-day max range per call (our 30+90 default is well under).
- Status mapping: `Cancelled` and `No-Show` → `cancelled`; everything else → `confirmed`.
- Response envelope: GetAllRooms/GetReservations wrap rows in a `Data` array (capital D). Listings `platform_id` comes from `room_name` (the operational room number); reservations match on `room_number`. (Fixed 2026-05-22, commit e3042a5 — see Changelog.)
- Activation: each property issues its own ApiToken (RoomRack PMS → Setup → Device Interface); RoomRack quoted €150 one-off per property.

### Hotelizer
- Base URL: https://app.hotelizer.net/api/integrations
- Auth: HTTP Basic — `api_key_name` (username) + `api_key_secret` (password). Public demo creds: `username` / `pass`.
- Key endpoints: /rooms (listings), /accommodations (booking sync; range-based `checkin_from`/`checkin_to`)
- `room.platform_id` = `rooms.name` (physical room number, e.g. "307"); sync fetches the window once per store, caches it, and filters client-side.
- Breakfast detection: `board_types.code` (BB/HB/FB/AI → true; RR/RO/NB → false; EN/EL free-text fallback).
- NOTE: the vendor also exposes /guests/grouped, but that is a single-arrival-date guest-registry export (passports/tax data), NOT the booking feed. Use /accommodations.

### Orange PMS (Marinet / Coral API)
- Base URL: https://hotel.orangepms.com/orange — single-page docs at https://hotel.orangepms.com/api.html
- Auth: HTTP Basic — `api_key_name` (username, or `username:hotelID` for multi-hotel accounts) + `api_key_secret` (password). Hotel ID auto-discovered via /hotels when the account has exactly one hotel. Demo: `wecook` / hotel 777 ("Zenith Premium Suites"), received from Marinet 2026-07-07.
- Key endpoints: /hotels, /hotels/{id}/rooms (physical rooms), /reservations?hotel=&departure_from=&arrival_to= (overlap window; dates YYYY-MM-DD both ways; no pagination — 926 rows verified in one response)
- `room.platform_id` = `RoomNumber`. Sync fetches the whole window once per store per cycle (module cache) and filters client-side — vendor asked for ~1 call/hour, so we do NOT use the server-side `room` filter.
- Breakfast detection: `MealPlan` field — vendor-confirmed vocabulary ROOM/BB/HB/FB/AI. BB/HB/FB/AI → true; ROOM → false; free-text EN/EL fallback.
- Status mapping: StatusCode 5 (Cancelled) and 8 (Wait list) → `cancelled` (a non-empty CancellationDate also forces cancelled); 1/2/3/6/7 → `confirmed`.

### Lodgify — partially verified live 2026-07-13 (Nexus Lodges key: listings + bookings + externalBookings shapes confirmed; add-on tier + full E2E order flow still pending)
- Base URLs: https://api.lodgify.com/v1 and /v2 (docs: https://docs.lodgify.com)
- Auth: `X-ApiKey` header — `api_key_secret` = the per-ACCOUNT key (host generates at Settings → Integrations → Public API); `api_key_name` unused.
- Key endpoints: /v1/properties (+ /v1/properties/{id}/rooms/{rid} for max_people/units/breakfast_included), /v2/reservations/bookings?includeQuoteDetails=true&stayFilter=Current|Upcoming (NO date-range params; paged 50/page)
- `room.platform_id` = `propertyId:roomTypeId` — Lodgify bookings identify room TYPES, never physical units (WebHotelier-class limitation; fine for whole-unit rentals, listings with units>1 are marked in Pull Listings).
- Breakfast detection (4-tier): (1) "Breakfast" add-on in quote.addon_items (OTA bookings never carry add-ons) → (2) **OTA MealPlan recovery**: GET /v2/reservations/bookings/{id}/externalBookings returns the raw Booking.com payload incl. free-text `MealPlan` (e.g. "Στην τιμή δωματίου περιλαμβάνεται πρωινό." / "…δεν περιλαμβάνεται κανένα γεύμα"); parsed negation-aware (deny-phrases before allow-keywords). Airbnb payloads have no MealPlan. Verified live 2026-07-13 vs Nexus Lodges booking 21583297 → (3) room-type `breakfast_included` amenity flag → (4) default false.
- Status mapping (strict): only `Booked` → `confirmed`; Open/Tentative/Declined, canceled_at, is_deleted → `cancelled`.
- Rate limits: 600/min (v1), 750/min (v2).

### GonnaOrder Integration — TWO endpoints (both MUST be configured in GonnaOrder → Settings → Integrations)
**1. Validation — `POST /api/validate-breakfast`** (called before an order is placed)
- Identifies breakfast items by `offer.countAgainstSlot >= 1` (top-level orderItems only; modifiers ignored). NOTE: earlier docs said `stockLevel`/`isStockCheckEnabled` — that is outdated; the live code uses `countAgainstSlot`.
- Looks up the room via `location.externalId`. Room matching is format-routed: UUID → `rooms.id`, else → `rooms.platform_id` (lowercased, since GonnaOrder forces uppercase). Convention: put the room's `platform_id` in GonnaOrder's External Id.
- Saves a tentative `validated` order row — which does NOT consume a slot.

**2. Order lifecycle — `POST /api/after-order`** (`after-order.js`; called on order status changes)
- This is what actually CONSUMES a breakfast slot. Decision (2026-05-21, commit bb088cc): consume on **ORDER_SUBMITTED**, not at validation time, so abandoned carts / menu-checks don't hold slots.
- Maps GonnaOrder events → `orders.status`: ORDER_SUBMITTED/RECEIVED → `submitted` (consume); ORDER_CLOSED/COMPLETED → `fulfilled`; ORDER_CANCELLED/REJECTED → `cancelled` (release). Idempotent, latest-event-wins.
- The double-order check in `validate-breakfast` counts only `submitted` + `fulfilled`. **If the after-order endpoint is not wired in GonnaOrder, slots are never consumed and repeat-order protection is inert.**

## Guest Messaging (Twilio WhatsApp/SMS) — added 2026-08-06
Breakfast reminders + review collection over WhatsApp. Full manual setup guide:
`docs/twilio-whatsapp-setup-guide.md`; decisions/context: `docs/whatsapp-messaging-handoff.md`.

- **Safe-by-default:** no Twilio env vars → the hourly sweep runs in **dry-run** (audience
  logged to `guest_messages` with status `dry_run`, nothing sent). Per-store master switch
  `stores.messaging_enabled` defaults to **false**.
- **Reminder rule ("simple + stop"):** at `stores.reminder_send_hour` (Athens), phones with a
  real order (`submitted`/`fulfilled`) whose `wish_date` is within the last 2 days, no order
  for tomorrow, <2 reminders since their last order, not opted out, none sent today.
  Phone source: `orders.raw_payload.customerPhoneNumber` (present on 100% of orders).
- **Review flow:** at `stores.review_send_hour` (Athens), one `review_request` (quick-reply
  rate_1/2/3) per phone per 30 days for phones with an order for today. Rating 3 → session
  reply with `stores.google_review_link`; 1–2 → "what went wrong?" captured privately in
  `reviews.comment`. Inbound param for the button id is read as ButtonPayload → Payload →
  ButtonText (VERIFY against the first real tap — full payload is logged in
  `guest_messages.meta.twilio_params`).
- **Language:** phone starts with +30 → Greek template, else English (EN Content SID falls
  back to GR if unset).
- **STOP:** stop/unsubscribe/cancel/στοπ/διαγραφή → `message_optouts` (global per phone).
- **SMS fallback:** WhatsApp reminder `failed`/`undelivered` → one plain SMS with the store's
  `public_link` (needs `TWILIO_SMS_FROM`). Review requests have no SMS fallback (buttons
  don't work over SMS).
- **Webhooks:** point Twilio at the DIRECT paths (`/.netlify/functions/whatsapp-inbound`,
  `.../whatsapp-status`), NOT `/api/*` redirects — signature validation covers the exact URL.
  Signature validation auto-skips (with console warning) while `TWILIO_AUTH_TOKEN` is unset.
- **Manual test:** `POST /.netlify/functions/force-messaging` with header
  `x-messaging-key: $MESSAGING_FORCE_KEY` and optional body `{"hour":18,"storeId":"…"}`.
- **Error 63016** = free-form message attempted outside the 24h session window.
- **Go-live:** Ioustinos' manual phases (Twilio account, sender registration, template
  approval) are in the docs/ guide; then set the env vars below and flip
  `messaging_enabled` per store.

## Supabase
- Project: horizon (project ID: gdreamjjadijdfoeymok)
- Tables: stores, rooms (was facilities), room_mappings, bookings, orders, sync_logs, settings, webhook_logs, guest_messages, reviews, message_optouts
- Messaging columns on stores: messaging_enabled (default false), reminder_send_hour (default 18), review_send_hour (default 19), google_review_link
- Key columns renamed: room_type (was facility_type), platform_id (was external_id)
- FK columns: room_id (was facility_id) in bookings, orders, sync_logs, room_mappings
- Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY set on Netlify

## Environment Variables (set on Netlify)
- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- HOSTHUB_API_KEY (demo key — needs to be verified)
- Guest messaging (all UNSET until Twilio go-live; feature dry-runs without them):
  - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (auth token also validates webhook signatures)
  - TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET (optional, preferred over auth token for API calls)
  - TWILIO_WHATSAPP_FROM (e.g. `whatsapp:+14155238886` sandbox), TWILIO_SMS_FROM
  - TPL_BREAKFAST_REMINDER, TPL_BREAKFAST_REMINDER_EN, TPL_REVIEW_REQUEST, TPL_REVIEW_REQUEST_EN (Content SIDs HX…)
  - MESSAGING_FORCE_KEY (shared secret for the force-messaging test endpoint)

## Naming Convention
- "Room" = any accommodation unit (hotel room, Airbnb rental, etc.) — previously called "Facility"
- "Platform ID" = the property/room ID from the booking platform (HostHub rental ID, WebHotelier room code, or RoomRack room number) — previously called "External ID"
- "Room ID" = our internal Horizon UUID — internal reference only
- **GonnaOrder mapping:** the room's `platform_id` is the canonical value to put in GonnaOrder's location External ID. The validator also accepts the Horizon UUID as a fallback (see `validate-breakfast.js` format-routing).

## Changelog / Decisions
Record every non-trivial change or decision here (and, if it came from or affects a skill, in that skill file too). Newest first.

- **2026-08-06 — Guest messaging feature (Twilio WhatsApp/SMS).** Full backend + admin UI
  built ahead of Twilio account creation: migration `guest_messaging_and_reviews`
  (guest_messages / reviews / message_optouts + store messaging columns), hourly
  `guest-messaging-background` sweep (per-store Athens send hours; simple+stop reminder
  rule; review requests evening of wish_date), `whatsapp-inbound` (ratings, STOP,
  private feedback), `whatsapp-status` (delivery tracking + SMS fallback),
  `force-messaging` test trigger, GuestMessages + Reviews admin pages, StoreForm
  messaging section. Dry-run until Twilio env vars exist. Twilio uses raw fetch — no SDK
  dependency added. See "Guest Messaging" section + docs/.

- **2026-07-10 — Orange PMS + Lodgify integrations.** Orange (Marinet): full 14-touchpoint rollout, demo creds verified (23 rooms, 926 reservations, MealPlan ROOM/BB), batch-and-cache sync to honor the vendor's ~1 call/hour preference. Lodgify: full rollout but **UNVERIFIED** — no API key exists yet (per-account key, host must generate); breakfast = Breakfast add-on → breakfast_included amenity fallback, per Lodgify product-team email 2026-07-10. Migration `expand_platform_provider_checks_for_orange_and_lodgify` applied (all 3 CHECKs). Lodgify platform_id convention: `propertyId:roomTypeId`.

- **2026-05-22 — HIT/Protel (push-based, hybrid).** Capture-only webhook receiver added at `/api/hit-webhook` (`hit-webhook.js`, commit fa4d8f6): logs full headers+body to `webhook_logs`, ACKs, no entity parsing yet. Per the HIT DataExchange spec (v1.0.2 **Draft**, 1 Mar 2024) our receiving URL must use SSL + require auth (Basic OR Token — our choice); to call HIT (pull Hotels, send ACK) we use a Bearer token from `api/identity/token` plus an HIT-issued ApplicationId. Architecture is hybrid: reservations pushed, config (Hotels) pulled. Full parser deferred until HIT activates us / first real payloads land. Spec PDF kept at `HIT-DataExchange-API-2026.pdf`. Blocked on HIT to issue credentials + push.
- **2026-05-22 — Hotelizer verified end-to-end.** Uses `/accommodations` (range booking feed), NOT `/guests/grouped`. See Hotelizer section.
- **2026-05-22 — RoomRack provider fix (commit e3042a5).** Unwrap the `Data` envelope; listings `platform_id` from `room_name` (not `room_number`/`room_id`). Verified end-to-end against the demo token.
- **2026-05-21 — Consume on ORDER_SUBMITTED (commit bb088cc).** Breakfast slots are consumed by `after-order.js` on ORDER_SUBMITTED, not at validation. Also fixed the `orders.status` CHECK to allow `submitted` and backfilled history. (CLAUDE.md previously mislabeled the file `order-webhook.js`; real name is `after-order.js`.)
