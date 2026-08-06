# Horizon — WhatsApp Messaging & Review Flow: Handoff / Status

**Context:** Adding Twilio WhatsApp breakfast reminders + a review mechanism to the EXISTING Horizon breakfast-validation app (not a new stack). Decisions and findings below were made on 2026-08-06.

## Decisions taken
1. **Platform: Twilio** (WhatsApp + SMS fallback). Viber is NOT supported by Twilio — parked for later via Yuboto/Messente/Infobip (~2–3 day sender approval) if the customer insists.
2. **Twilio account status: nothing created yet.** Build everything env-var driven and sandbox-ready (sandbox number +1 415 523 8886, `join <code>`), so account creation → test is minutes.
3. **Reminder rule: "simple + stop".** Day after each order: if that phone has no order with `wish_date = tomorrow`, send one reminder. Stop after 2 consecutive ignored reminders per guest/stay. No dependency on check-out dates.
4. **Review flow:** post-breakfast `review_request` template with 3 quick-reply buttons (ids `rate_1/2/3`). Reply opens 24h session → free-form follow-up: top rating → Google review link; low rating → "what went wrong?" captured privately.

## Key findings from the Horizon Supabase DB (project ref: `gdreamjjadijdfoeymok`)
- `orders.raw_payload.customerPhoneNumber` exists on **100% of orders (2,643/2,643), all `+`-prefixed** — plus `customerName`, `customerEmail`. The reminder audience is fully reachable from existing data.
- Order-placed webhook infra already exists (`orders`, `webhook_logs` tables) — review request hooks into it.
- **Only 127/2,643 orders have `booking_id`** → check-out date is mostly unknown; that's why the simple + stop rule was chosen. (`bookings.raw_data.guest_phone` exists and could improve matching later.)
- Tables: stores, rooms, bookings, orders, sync_logs, room_mappings, settings, webhook_logs. RLS enabled everywhere.

## To build (in the existing repo)
1. Migration: `guest_messages` (phone, template, message_sid, status, order_id, sent_at) and `reviews` (phone, order_id, rating, comment, created_at); opt-out flag per phone.
2. Scheduled function: daily reminder job implementing the simple + stop rule; log every send to `guest_messages`.
3. Inbound webhook function: parse Twilio POST (form-encoded; quick-reply id arrives as `ButtonPayload` — VERIFY the param name by logging the first real payload), save rating, branch happy/unhappy, honor STOP.
4. Status callback function: update `guest_messages.status` (delivered/read/failed; error 63016 = tried free-form outside 24h window).
5. SMS fallback when WhatsApp delivery fails.
6. Twilio request signature validation on both webhooks.

## Manual steps for Ioustinos (Phases 1–4 of the full guide)
Create Twilio account → upgrade off trial → buy number → sandbox test → register WhatsApp sender (Facebook login + OTP; ~same day, 250 uniques/24h cap unverified — fine at these volumes) → submit templates `breakfast_reminder` (GR+EN, Marketing, CTA → GonnaOrder link) and `review_request` (quick-reply ×3) → drop Content SIDs + creds into env.

**Full step-by-step guide:** `twilio-whatsapp-setup-guide.md` — saved in the "Horizon - SMS and Whatsapp Notifications" Claude project (claude/twilio-whatsapp-setup-guide.md) and delivered as a file in that chat. Re-attach or re-save it into the new project.
