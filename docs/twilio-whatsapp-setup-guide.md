# Horizon — Twilio WhatsApp Setup Guide

**Goal:** Send breakfast reminder messages (day 2, day 3…) to guests who ordered their first breakfast, plus a post-breakfast review flow with tappable rating buttons — all over one Twilio WhatsApp sender, driven from the Horizon backend (Netlify Functions + Supabase).

**Realistic timeline:** Sandbox testing in ~30 minutes. Real sender live the same day at low volume (up to 250 unique customers / 24h unverified). Full Meta business verification (optional, for scale + branded display name) can take days to weeks — start it early, don't block on it.

---

## Phase 0 — What to have ready (10 min)

1. **A Facebook account** that is (or can become) admin of a **Meta Business Portfolio** for the business sending the messages. Decide up front *whose* business this is — Horizon's or the hotel's. The display name guests see comes from this. If a portfolio already exists (e.g. the hotel runs Facebook/Instagram ads), use it — an established, verified portfolio skips a lot of friction.
2. **A phone number decision.** Easiest: buy a number from Twilio (~$1–1.15/month) and dedicate it to WhatsApp. You can also bring an existing number, but it must NOT already be registered on WhatsApp (a number can't be on the WhatsApp app and the API at the same time), and it must be able to receive an SMS or voice OTP.
3. **Credit card** for Twilio billing (trial credit exists, but trial accounts have restrictions — upgrade early to avoid confusing errors).
4. **Business details** for the sender profile: display name (e.g. "Horizon Breakfast"), logo image, website URL, business category, description.

> ⚠️ Display name rules: Meta reviews the display name. It should match the business/website. A rejected display name doesn't block sending, but caps you at 250 business-initiated messages/24h and shows the raw phone number to guests until fixed.

---

## Phase 1 — Twilio account + phone number (15 min)

1. Sign up at twilio.com → verify email + your personal phone.
2. **Upgrade the account** (Billing → add card + funds, e.g. $20). Trial accounts can only message verified numbers and add a trial notice.
3. Console → **Phone Numbers → Buy a Number**. For WhatsApp the country of the number barely matters to guests (they see the display name), so a US number (+1) is the cheapest and most available choice and works fine for WhatsApp to Greek guests. Buy one with SMS capability.
4. Note down from the Console dashboard: **Account SID** and **Auth Token**. Better practice: create an **API Key** (Account → API keys) and use key SID + secret in code instead of the master auth token.

---

## Phase 2 — Sandbox: prove the plumbing today (30 min)

Before any Meta approvals, test end-to-end with the shared sandbox number.

1. Console → **Messaging → Try it out → Send a WhatsApp message**. Activate the sandbox.
2. From your own WhatsApp, send `join <your-sandbox-code>` to **+1 415 523 8886** (or scan the QR). Sandbox sessions last 3 days, then you re-join.
3. Send yourself a test message from the console or via API:

```bash
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json" \
  --data-urlencode "From=whatsapp:+14155238886" \
  --data-urlencode "To=whatsapp:+30XXXXXXXXXX" \
  --data-urlencode "Body=Hello from Horizon 🍳" \
  -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN
```

4. In the sandbox settings, set **"When a message comes in"** to a Netlify function URL (e.g. `https://<your-site>.netlify.app/.netlify/functions/whatsapp-inbound`) and reply to the message from your phone — confirm the webhook fires. This validates the exact plumbing the review flow will use.

Sandbox limits: only joined numbers, 1 msg / 3 seconds, canned templates only — fine for plumbing tests, not for template testing.

---

## Phase 3 — Register the real WhatsApp sender (30–60 min active work)

Console → **Messaging → Senders → WhatsApp senders → Create new sender** (Twilio's "Self Sign-up" flow).

1. Pick the Twilio number you bought in Phase 1.
2. Click **Login with Facebook** → in the embedded Meta flow, select (or create) the **Business Portfolio** and create a **WhatsApp Business Account (WABA)**.
3. Enter the sender profile: display name, category, description, logo, website.
4. Verify number ownership via **SMS or voice OTP** (this is why the number must be SMS-capable and not behind an IVR).
5. Submit. The sender typically goes to **Online** quickly (minutes to hours). Meta's display-name review happens in parallel.
6. **Start Meta business verification now** (Meta Business Manager → Security Center → Start verification — company documents, domain/email checks). You don't need it to launch at Horizon's volumes, but it lifts the 250-unique-customers/24h cap to 1k → 10k → 100k tiers and locks in the branded display name. It can take days to weeks, so fire and forget.

> Honest caveat: Meta's flows change UI frequently and behave differently for brand-new vs. established portfolios. The steps above match Twilio's current docs, but expect small differences on screen. If the flow insists on verification before "production," you're in the new-portfolio case — you can still test, and low-volume sending generally works while verification is pending.

---

## Phase 4 — Message templates (1–2 h including approval wait)

Business-initiated WhatsApp messages **must** use Meta-approved templates. Build them in Console → **Messaging → Content Template Builder**. Approval usually takes minutes to a few hours.

Create these four:

### 4.1 `breakfast_reminder` — type: text or card with CTA button
Category: **Marketing** (it nudges a purchase — don't try to sneak it in as Utility; miscategorized templates get rejected or recategorized).

> Καλημέρα {{1}}! 🍳 Το χθεσινό πρωινό ήταν μόνο η αρχή. Θέλετε να παραγγείλετε και για αύριο;
> Button (CTA/URL): "Παραγγελία" → your GonnaOrder store URL (can carry a `{{2}}` URL suffix for per-guest tracking).

Make an English twin (`breakfast_reminder_en`) — templates are per-language, and guests are often foreign visitors. Send the right one based on the guest's booking language.

### 4.2 `review_request` — type: **twilio/quick-reply**
Category: Marketing (safe default; Utility is arguable but risky).

> How was your breakfast today, {{1}}? 🙂
> Quick replies (max 3): `😍 Great` / `🙂 Okay` / `😞 Not good`

Each button can carry a hidden `id` (e.g. `rate_3`, `rate_2`, `rate_1`) that arrives in your webhook — key the logic on the id, not the emoji text.

### 4.3 `review_thanks_link` — follow-up for happy guests *(often not needed as a template — see Phase 6; a session message usually covers it)*

### 4.4 SMS fallback (no approval needed)
Plain SMS body for guests without WhatsApp — same reminder text with the GonnaOrder link. Nothing to pre-approve; SMS just sends. (Alphanumeric sender IDs like "Horizon" work for SMS to Greece without pre-registration as of Twilio's current docs — verify on Twilio's Greece SMS guidelines page before relying on it.)

After approval, each template has a **Content SID** (`HX…`). Store these in env vars or a Supabase config table.

---

## Phase 5 — Sending from Horizon (2–3 h)

Env vars in Netlify: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or API key pair), `TWILIO_WHATSAPP_FROM` (e.g. `whatsapp:+1XXXXXXXXXX`), plus the Content SIDs.

```js
// netlify/functions/send-breakfast-reminder.js
import twilio from "twilio";
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function sendReminder(guest) {
  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: `whatsapp:${guest.phoneE164}`,          // e.g. whatsapp:+306912345678
    contentSid: process.env.TPL_BREAKFAST_REMINDER, // HX...
    contentVariables: JSON.stringify({ 1: guest.firstName }),
    statusCallback: `${process.env.SITE_URL}/.netlify/functions/whatsapp-status`,
  });
}
```

Scheduling: a daily scheduled Netlify function (or Supabase cron/pg_cron) queries "guests whose first breakfast was yesterday, still checked-in, no order for tomorrow, not opted out" and calls `sendReminder`. Log every send to a `messages` table (guest, template, message SID, status) — you'll want it for debugging and for the 24h-window logic below.

**Phone numbers must be E.164** (`+30…`). Booking systems often store junk — normalize and validate before sending; Twilio's Lookup API ($/lookup) can pre-check if quality is bad.

**Opt-in / opt-out:** Meta requires guests to have opted in to receive business messages — bake consent into the first breakfast order flow (GonnaOrder checkout note / hotel check-in). Honor "STOP"-style replies by flagging the guest in Supabase and never sending again. This protects your number's quality rating, which is what actually gets senders throttled or banned.

---

## Phase 6 — Review flow: inbound webhook (2–3 h)

Set the WhatsApp sender's inbound webhook (Console → the sender's configuration → "When a message comes in") to your function.

```js
// netlify/functions/whatsapp-inbound.js
export default async (req) => {
  const params = new URLSearchParams(await req.text()); // Twilio posts form-encoded
  const from = params.get("From");           // whatsapp:+30691...
  const body = params.get("Body");           // button text or free text
  const buttonId = params.get("ButtonPayload") ?? null; // quick-reply id, e.g. "rate_3"

  if (buttonId?.startsWith("rate_")) {
    const rating = Number(buttonId.split("_")[1]);      // 1..3
    await saveRating(from, rating);                     // -> Supabase reviews table

    // Guest replied → a 24h customer-service window is open → free-form messages allowed, no template needed
    if (rating === 3) {
      await sendSession(from, "Thank you! 🙏 It would mean a lot if you shared it publicly: https://g.page/r/<hotel-google-review-link>");
    } else {
      await sendSession(from, "Sorry to hear that — what could we improve? Just reply here, the team reads every message.");
    }
  } else if (body) {
    await saveComment(from, body);  // free-text complaint/comment lands privately in Supabase
  }
  return new Response("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
};
```

`sendSession` is a plain `client.messages.create({ from, to, body })` — inside the 24-hour window opened by the guest's reply, no template is required.

Supabase tables: `reviews (guest_id, order_id, rating, comment, created_at)` — this is the private-feedback loop: happy guests get routed to the public Google review, unhappy ones vent privately. That branch is the whole value of the mechanism.

> Small uncertainty flag: the exact parameter name for the quick-reply id in Twilio's inbound webhook (`ButtonPayload` vs `ButtonText`) has varied across API versions — log the full webhook payload on your first test tap and key off what actually arrives. Two minutes of checking beats trusting this doc.

**Timing the review ask:** send `review_request` ~1–2 hours after the breakfast delivery slot. If the guest never replies, don't chase — one ask per stay.

---

## Phase 7 — Status callbacks, costs, go-live checklist

**Status callbacks** (`whatsapp-status` function): Twilio posts `queued → sent → delivered → read / failed` per message. Store on the `messages` row. `failed` with error 63016 = tried to send free-form outside the 24h window (use a template); undelivered often = number not on WhatsApp → fall back to SMS for that guest.

**Costs (approximate — check Twilio's live pricing page for Greece before quoting the customer):**
- Twilio number: ~$1–1.15/month
- WhatsApp: Meta per-message fee (marketing templates to Greece are on the order of €0.10–0.15; utility much cheaper; session/service messages within 24h window are free from Meta) + Twilio's ~$0.005 per message
- SMS to Greece: roughly €0.07–0.09/message
- At hotel-breakfast volumes this is coffee money; still, put real numbers from the pricing page into the customer quote.

**Go-live checklist:**
- [ ] Account upgraded (off trial)
- [ ] Sender shows **Online**, display name approved
- [ ] Meta business verification submitted (not necessarily completed)
- [ ] Templates approved (GR + EN), Content SIDs in env
- [ ] Inbound + status webhooks pointing at production functions, signature validation on (`twilio.validateRequest`) so random POSTs can't fake ratings
- [ ] Opt-in captured in order flow; opt-out honored
- [ ] `messages` + `reviews` tables live; first real send tested on your own phone
- [ ] Fallback: guest without WhatsApp gets SMS instead (send WhatsApp first, on failure/undelivered send SMS)

---

## Known gotchas (learned the hard way by many)

1. **Number already on WhatsApp app** → registration fails. Use a fresh number.
2. **Trial account weirdness** → upgrade before debugging anything.
3. **Template rejected for category mismatch** → reminders that sell = Marketing, always.
4. **24h window confusion** → business-initiated = template, always; replies open a free-form window; error 63016 is the tell.
5. **Quality rating drops** → too many sends to guests who didn't opt in, or ignored opt-outs. Volume caps follow. Keep it to genuinely useful, expected messages.
6. **Viber is NOT part of this** — Twilio doesn't support it. If the customer wants Viber later, that's a separate sender application via Yuboto/Messente/Infobip (~2–3 business days approval).
