# Horizon — Context for Claude

## What This App Does
Breakfast entitlement validator. Syncs hotel bookings from HostHub, WebHotelier, RoomRack, and Hotelizer APIs into Supabase. GonnaOrder calls our validation endpoint to check if breakfast is included for a specific booking.

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

### GonnaOrder Integration — TWO endpoints (both MUST be configured in GonnaOrder → Settings → Integrations)
**1. Validation — `POST /api/validate-breakfast`** (called before an order is placed)
- Identifies breakfast items by `offer.countAgainstSlot >= 1` (top-level orderItems only; modifiers ignored). NOTE: earlier docs said `stockLevel`/`isStockCheckEnabled` — that is outdated; the live code uses `countAgainstSlot`.
- Looks up the room via `location.externalId`. Room matching is format-routed: UUID → `rooms.id`, else → `rooms.platform_id` (lowercased, since GonnaOrder forces uppercase). Convention: put the room's `platform_id` in GonnaOrder's External Id.
- Saves a tentative `validated` order row — which does NOT consume a slot.

**2. Order lifecycle — `POST /api/after-order`** (`after-order.js`; called on order status changes)
- This is what actually CONSUMES a breakfast slot. Decision (2026-05-21, commit bb088cc): consume on **ORDER_SUBMITTED**, not at validation time, so abandoned carts / menu-checks don't hold slots.
- Maps GonnaOrder events → `orders.status`: ORDER_SUBMITTED/RECEIVED → `submitted` (consume); ORDER_CLOSED/COMPLETED → `fulfilled`; ORDER_CANCELLED/REJECTED → `cancelled` (release). Idempotent, latest-event-wins.
- The double-order check in `validate-breakfast` counts only `submitted` + `fulfilled`. **If the after-order endpoint is not wired in GonnaOrder, slots are never consumed and repeat-order protection is inert.**

## Supabase
- Project: horizon (project ID: gdreamjjadijdfoeymok)
- Tables: stores, rooms (was facilities), room_mappings, bookings, orders, sync_logs, settings
- Key columns renamed: room_type (was facility_type), platform_id (was external_id)
- FK columns: room_id (was facility_id) in bookings, orders, sync_logs, room_mappings
- Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY set on Netlify

## Environment Variables (set on Netlify)
- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- HOSTHUB_API_KEY (demo key — needs to be verified)

## Naming Convention
- "Room" = any accommodation unit (hotel room, Airbnb rental, etc.) — previously called "Facility"
- "Platform ID" = the property/room ID from the booking platform (HostHub rental ID, WebHotelier room code, or RoomRack room number) — previously called "External ID"
- "Room ID" = our internal Horizon UUID — internal reference only
- **GonnaOrder mapping:** the room's `platform_id` is the canonical value to put in GonnaOrder's location External ID. The validator also accepts the Horizon UUID as a fallback (see `validate-breakfast.js` format-routing).

## Changelog / Decisions
Record every non-trivial change or decision here (and, if it came from or affects a skill, in that skill file too). Newest first.

- **2026-05-22 — HIT/Protel (push-based, hybrid).** Capture-only webhook receiver added at `/api/hit-webhook` (`hit-webhook.js`, commit fa4d8f6): logs full headers+body to `webhook_logs`, ACKs, no entity parsing yet. Per the HIT DataExchange spec (v1.0.2 **Draft**, 1 Mar 2024) our receiving URL must use SSL + require auth (Basic OR Token — our choice); to call HIT (pull Hotels, send ACK) we use a Bearer token from `api/identity/token` plus an HIT-issued ApplicationId. Architecture is hybrid: reservations pushed, config (Hotels) pulled. Full parser deferred until HIT activates us / first real payloads land. Spec PDF kept at `HIT-DataExchange-API-2026.pdf`. Blocked on HIT to issue credentials + push.
- **2026-05-22 — Hotelizer verified end-to-end.** Uses `/accommodations` (range booking feed), NOT `/guests/grouped`. See Hotelizer section.
- **2026-05-22 — RoomRack provider fix (commit e3042a5).** Unwrap the `Data` envelope; listings `platform_id` from `room_name` (not `room_number`/`room_id`). Verified end-to-end against the demo token.
- **2026-05-21 — Consume on ORDER_SUBMITTED (commit bb088cc).** Breakfast slots are consumed by `after-order.js` on ORDER_SUBMITTED, not at validation. Also fixed the `orders.status` CHECK to allow `submitted` and backfilled history. (CLAUDE.md previously mislabeled the file `order-webhook.js`; real name is `after-order.js`.)
