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

## Git Workflow
Always run `git pull origin main` before making changes.
After edits:
```
git add -A
git commit -m "your message"
git push origin main
```
The PAT for git push is stored in the remote URL already. Never use browser-based git or Netlify CLI.

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
- Looks up room by internal ID via `locationExternalId` field from GonnaOrder
- Room matching: `rooms.id = order.locationExternalId` (our Horizon room UUID)

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
- "Room ID" = our internal Horizon UUID — entered into GonnaOrder's location externalId field
