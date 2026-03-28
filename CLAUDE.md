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
│   └── test-hosthub.js         # Diagnostic: test HostHub API auth
├── src/                        # React frontend (store config UI — TBD)
├── netlify.toml                # build: npm run build → dist/, functions dir
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
- Checks for HORIZON_BREAKFAST tagged items in the order
- Looks up booking in Supabase by store + location + date

## Supabase
- Project: horizon (check Supabase MCP for project ID)
- Tables: stores, room_mappings, bookings, sync_logs
- Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY set on Netlify

## Environment Variables (set on Netlify)
- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- HOSTHUB_API_KEY (demo key — needs to be verified)
