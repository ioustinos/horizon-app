# Horizon — Context for Claude

## What This App Does
Breakfast entitlement validator. Syncs hotel bookings from WebHotelier and HostHub APIs into Supabase. GonnaOrder calls our validation endpoint to check if breakfast is included for a specific booking.

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
│   ├── sync-bookings.js        # Syncs WebHotelier + HostHub → Supabase
│   ├── force-sync.js           # Manual per-room sync trigger
│   ├── fetch-listings.js       # Fetches listings from platforms
│   ├── order-webhook.js        # GonnaOrder lifecycle webhook
│   └── test-hosthub.js         # Diagnostic: test HostHub API auth
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
- Staging base URL: https://eric.hosthub.com/api/2019-03-01
- Auth header: `Authorization: apiKey <key>` (NOT Bearer)
- Key endpoints: /rentals, /calendar_events (NOT /bookings)
- Demo account API key: stored in HOSTHUB_API_KEY env var on Netlify

### WebHotelier
- Credentials stored in Supabase `stores` table per property
- Auth: Basic (username:password base64)

### GonnaOrder Validation
- Endpoint: POST /api/validate-breakfast
- Checks for breakfast items (offer.stockLevel === 0 && offer.isStockCheckEnabled === true)
- Looks up room via `locationExternalId` field from GonnaOrder
- Room matching: format-routed — UUID → `rooms.id`, otherwise → `rooms.platform_id` (lowercased, since GonnaOrder forces uppercase). Per current convention, populate GonnaOrder with the room's `platform_id`.

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
- "Platform ID" = the property/room ID from the booking platform (HostHub or WebHotelier) — previously called "External ID"
- "Room ID" = our internal Horizon UUID — internal reference only
- **GonnaOrder mapping:** the room's `platform_id` is the canonical value to put in GonnaOrder's location External ID. The validator also accepts the Horizon UUID as a fallback (see `validate-breakfast.js` format-routing).
