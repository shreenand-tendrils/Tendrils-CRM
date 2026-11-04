# WhatsApp + MCP — Architecture & Setup Guide (v4.9.0)

Two new ways to reach Tendrils without opening the web app:

| Door | Who uses it | What it does |
|---|---|---|
| **WhatsApp** | Employees *and* clients | Alerts on their phone; chat commands (`tasks`, `done 2`, `new …`, `approve 1`); photo → ticket attachment; optional AI free-text assistant |
| **MCP server** | Employees (and clients) using Claude Desktop / Claude Code / any MCP app | AI assistant that can read and update tickets & tasks **as that person, with exactly their permissions** |

---
## 1. Brainstorm → decisions

| Question | Options considered | Decision & why |
|---|---|---|
| WhatsApp provider | Cloud API (Meta) · Twilio · unofficial libs (whatsapp-web.js) | **Meta Cloud API.** Official, no per-message BSP fee for service replies, no risk of ban. Unofficial libs break and violate ToS. |
| Who is this number? | OTP over SMS · admin types numbers · self-link | **Self-link by code.** Web app shows `LINK TDL-XXXXXX`; the user sends it *from their phone* to the business number. That proves ownership with no SMS cost and no admin work. One number ↔ one user. |
| Alerts outside the 24h window | Only reply inside window · templates | **Both.** Inside 24h: normal text. Outside: one approved *Utility* template (`tendrils_update`, 3 variables). No template → alert stays in-app/email only. |
| Where is notification logic? | New notification system · hook existing | **One hook inside `notifyUser()`**. Every existing feature (assignment, mention, review requested, overdue…) now also reaches WhatsApp, filtered by per-user type preferences. |
| Commands vs AI | Only commands · only AI · both | **Both.** Deterministic commands are free, instant, predictable. Free text goes to the AI only if `ANTHROPIC_API_KEY` is set. |
| How do WhatsApp/MCP change data safely? | Duplicate business rules · call the DB directly · call our own REST API | **Call our own REST API *as the user*.** Zero duplicated rules: RBAC, validation, ticket↔task sync, client-review flow, notifications and audit log behave exactly like the web app. |
| MCP auth | OAuth · personal access token | **Personal access token (PAT)** now: hashed in DB, expiring, revocable, optional read-only. OAuth is the next phase (needed for the claude.ai web "custom connector" UI). |
| AI safety | Let the model write freely · confirm writes | **The model never executes a write.** It proposes; the user replies **YES**. Ticket text can't trick it into changing data. MCP marks write tools so clients ask before running them. |

---
## 2. Architecture

```
                       ┌────────────────────────── Tendrils API (Express, Render) ──────────────────────────┐
 Employee / Client     │                                                                                    │
 phone  ──WhatsApp──►  Meta Cloud API ──POST /webhooks/whatsapp──►  [HMAC signature check]                  │
                       │                                              │ parse → idempotency (wamid)         │
                       │                                              ▼                                     │
                       │                                   inbound.js: link code? known sender?             │
                       │                                              ▼                                     │
                       │                              bot.js  (commands, wizard, media)  ──free text──► agent.js
                       │                                              │                         (optional, Claude)
 Claude Desktop /      │                                              ▼                                     │
 Claude Code / MCP app │   POST /mcp  (Bearer tdl_…)   ┌──────── agent/tools.js  (ONE tool registry) ───────┤
        ──────────────►│   [PAT hash lookup, rate-limit]│  list_tickets get_ticket create_ticket update_task …│
                       │   mcp/server.js ───────────────►└───────────────────────┬────────────────────────┘
                       │                                                          │ apiFor(userId)
                       │                                                          ▼
                       │                         internalApi.js: loopback HTTP + short-lived HMAC header
                       │                                                          ▼
                       │            existing REST  /api/v1/*  (requireUser → RBAC → routes → services → Prisma/Postgres)
                       │                                                          │
                       │   notifyUser() ──► in-app + websocket ──► whatsapp/notify.js ──► Cloud API (text or template)
                       └────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Components (all under `apps/api/src`)
| File | Responsibility |
|---|---|
| `services/internalApi.js`, `middleware/internalAuth.js` | "Act as user X" without a browser: signed header `x-tendrils-internal = userId.exp.HMAC` (60 s TTL). `requireUser` accepts it; forged/expired headers are ignored. |
| `services/pat.js`, `routes/integrations.routes.js` | Personal access tokens (`tdl_…`, only sha256 stored, shown once); WhatsApp link/prefs/test APIs; admin overview. |
| `agent/tools.js` | The shared tool registry (17 tools, zod-validated, `write:true` flagged). Handlers are thin wrappers over REST. |
| `mcp/server.js`, `routes/mcp.routes.js` | Stateless Streamable-HTTP MCP endpoint `POST /mcp`; bearer-only; Origin check; per-token rate limit; read-only tokens hide write tools; 3 prompts (`daily_standup`, `triage_inbox`, `client_status`). |
| `routes/whatsapp.webhook.js` | `GET` verify handshake; `POST` signature-checked, replies 200 fast, processes in background (or inline on serverless). |
| `services/whatsapp/cloud.js` | Graph API client: text, buttons, template, mark-read, media download. Logs every outbound message. |
| `services/whatsapp/link.js` | One-time code issue/verify, number↔user uniqueness, notification type defaults. |
| `services/whatsapp/inbound.js` | Dedupe by `wamid`, per-phone ordering + rate-limit, unknown-sender nudge, 24h window refresh. |
| `services/whatsapp/bot.js` | Command parser, numbered lists (context kept 2 h), ticket-creation wizard, task status, comments, client approvals, media → attachment. |
| `services/whatsapp/agent.js` | Optional Claude loop over the same tools; writes parked until YES. |
| `services/whatsapp/notify.js` | Outbound alerts (hooked in `services/activity.js → notifyUser`). |

### 2.2 Data model (migration `20261110090000_whatsapp_mcp`)
`WhatsAppLink` (1 per user: phone, status, code hash, prefs, 24h window, bot context) · `WhatsAppMessage` (audit + idempotency + delivery status; bodies truncated) · `ApiToken` (hash, prefix, scopes, expiry, revoke).

### 2.3 Key flows
1. **Link:** Settings → *Link WhatsApp* → code → user sends `LINK TDL-ABC234` from phone → webhook → `completeLink` → ACTIVE (code single-use, 15 min).
2. **Inbound command:** `done 2` → verify signature → dedupe → find user by phone → `apiFor(user).patch('/tasks/:id')` → REST enforces "only the assignee can change status" → reply with the REST error text if refused.
3. **Alert:** any `notifyUser()` → if user linked + type enabled → in-window text, else template.
4. **Client approval from phone:** `reviews` → `approve 1` → `POST /tickets/:id/tasks/:taskId/review` → last approval auto-closes ticket (existing v4.8.27 rule).
5. **MCP:** client sends `Authorization: Bearer tdl_…` → token → user → tool → REST as user.

### 2.4 Security model
- Webhook trusted only via **HMAC-SHA256 of the raw body** (`WHATSAPP_APP_SECRET`); unsigned requests rejected (dev-only bypass, ignored in production).
- Phone ownership proven by sending a one-time code; a number can't be linked to two accounts.
- WhatsApp/MCP can **never exceed the user's web permissions** (same REST + RBAC). Tokens/links can't be created from WhatsApp or MCP themselves.
- PAT: hashed, expiring (default 90 d), revocable, ≤10 active, optional read-only; token creation is written to the audit log.
- MCP is bearer-only (cookies never accepted) + Origin validation + rate limit.
- Staff WhatsApp comments are **internal by default**; `reply …` is the explicit client-visible form.
- AI: reads run automatically, **writes need YES**; ticket text is treated as data.
- Message bodies are truncated in the log; admin screen shows status only, not content.

---
## 3. Setup — phase by phase

### Phase 1 — Database & deploy
1. Unzip, `npm install` (adds `@modelcontextprotocol/sdk`).
2. `npm run db:generate` then `npm run db:deploy` (Render: your deploy command already runs `prisma migrate deploy`).
3. Redeploy API (Render) and web (Vercel). Nothing else changes for existing users; WhatsApp/MCP stay dormant until configured.

### Phase 2 — Meta WhatsApp Cloud API
(Meta's console labels change occasionally; names below are the usual ones.)
1. developers.facebook.com → **Create app** → type *Business* → add the **WhatsApp** product.
2. *WhatsApp → API Setup*: note the **Phone number ID** and the test number. Add up to 5 recipient numbers for testing.
3. **App Secret**: *App settings → Basic* → copy (→ `WHATSAPP_APP_SECRET`).
4. **Permanent token**: Business Settings → *System users* → create user → assign the WhatsApp account → generate token with `whatsapp_business_messaging` + `whatsapp_business_management` (→ `WHATSAPP_TOKEN`). The 24 h temp token is fine for first tests only.
5. For production use your own number (needs Meta Business verification); put its digits in `WHATSAPP_BUSINESS_NUMBER`.

### Phase 3 — Environment variables (Render → Environment)
See `.env.example` / `apps/api/.env.render.example`. Minimum: `PUBLIC_API_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`. Then redeploy.

### Phase 4 — Webhook
Meta → *WhatsApp → Configuration → Webhook*:
- **Callback URL:** `https://tendrils-crm.onrender.com/webhooks/whatsapp` (**direct Render URL**, not the Vercel one — Vercel only proxies `/api` and `/auth`).
- **Verify token:** the same string as `WHATSAPP_VERIFY_TOKEN` → *Verify and save*.
- Subscribe to field **`messages`**.

### Phase 5 — Notification template (for alerts outside 24 h)
Meta → *Message templates* → Create: name **`tendrils_update`**, category **Utility**, language English, body:
```
Tendrils update 🔔
{{1}}
{{2}}
Open in Tendrils: {{3}}
Reply HELP for commands.
```
Samples: `Assigned to you` / `SOF-123456 — Fix header` / `https://tendrils-crm.vercel.app/?ticket=abc`. After approval set `WHATSAPP_TEMPLATE_NOTIFY=tendrils_update`.

### Phase 6 — Link & test
1. Web → **Settings → WhatsApp → Link WhatsApp** → tap *Open WhatsApp* (or send the shown `LINK …` text) → page flips to *Linked*.
2. Send `help`, `tasks`, `tickets` to the bot. Press **Send test**.
3. Admin → Settings shows the health checklist (keys, signature secret, template, last 7 days, linked users).

### Phase 7 — MCP
1. **Settings → AI assistants (MCP) → Create token** (name it, pick expiry, optionally *Read-only*). Copy it once.
2. **Claude Code:**
   `claude mcp add --transport http tendrils https://tendrils-crm.onrender.com/mcp --header "Authorization: Bearer tdl_…"`
3. **Claude Desktop** → Settings → Developer → Edit config (uses the `mcp-remote` bridge):
```json
{ "mcpServers": { "tendrils": { "command": "npx",
  "args": ["-y", "mcp-remote", "https://tendrils-crm.onrender.com/mcp", "--header", "Authorization: Bearer tdl_…"] } } }
```
4. Try: *"What tickets are assigned to me and overdue?"*, *"Comment on SOF-123456: fix deployed"*, or the built-in prompts (`daily_standup`, `triage_inbox`, `client_status`).
> The claude.ai **web** custom-connector dialog expects OAuth, which is Phase 2 of the roadmap below; PATs work for Claude Code/Desktop and other MCP clients.

### Phase 8 — Optional AI on WhatsApp
Set `ANTHROPIC_API_KEY` (and optionally `WHATSAPP_AI_MODEL`, default `claude-haiku-5-5`). Free text such as *"overdue kya hai mera?"* now works; any change shows *Confirm?* with **Yes/Cancel** buttons. Users can switch it off in Settings.

---
## 4. WhatsApp cheat-sheet
**Staff:** `tasks` · `tickets` · `ticket SOF-123456` / `ticket 2` · `start 2` `review 2` `done 2` `block 2` · `comment <key|n> text` (internal) · `reply <key|n> text` (client-visible) · `new <title>` (asks team/client if needed) · `inbox` · `read all` · photo/file with the key as caption · `stop` / `resume`.
**Clients:** `tickets` · `ticket SOF-123456` · `reviews` → `approve 1` / `changes 1 <what to fix>` · `comment <key> text` · `new <title>` (asks which team) · photo/file with key as caption.
Numbers (`2`) refer to the last list shown (valid 2 h).

## 5. MCP tools
`whoami` `dashboard_summary` `list_tickets` `get_ticket` `create_ticket`✎ `update_ticket`✎ `comment_ticket`✎ `list_tasks` `update_task`✎ `create_task`✎ `comment_task`✎ `tasks_waiting_my_review` `review_task`✎ `list_notifications` `mark_notifications_read`✎ `list_teams` `list_projects`  (✎ = changes data; hidden for read-only tokens).

## 6. Testing
- `npm test` → new suite `apps/api/test/whatsapp_mcp.test.js` (13 tests: signatures, webhook, link codes, bot flow, window/template logic, MCP over real HTTP, read-only tokens, AI parking of writes). *Note: 9 older tests (members/chat HTTP suites) already failed on the v4.8.30 zip before these changes — same 89 pass / 9 fail; they need a separate look.*
- Webhook by hand: `curl "https://…/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123"` → `123`.
- MCP by hand: `curl -X POST https://…/mcp -H "Authorization: Bearer tdl_…" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`.
- Not verifiable offline (needs your Meta account): real message delivery, template approval, Meta's webhook retries.

## 7. Operations & AWS Lambda notes
- Render free tier sleeps → first WhatsApp message after idle can be slow; Meta retries are deduped by `wamid`. Use a paid instance for production.
- In-memory pieces (per-phone ordering/rate-limit, websocket hub) assume **one instance**; for multi-instance/Lambda move them to Redis (already the plan for the hub).
- Lambda: set `INTERNAL_API_URL` (public API URL) because there is no loopback port, `WHATSAPP_PROCESS_INLINE=true`, and keep `INTERNAL_API_SECRET` identical on all instances.
- Uploads from WhatsApp use the same `UPLOAD_DIR` as web uploads (move to S3 together with them).

## 8. Known limits / roadmap
1. OAuth 2.1 for MCP (claude.ai web connector, per-app consent) — next.
2. WhatsApp groups (Cloud API support is limited), voice notes → transcript, location, quiet hours / daily digest template.
3. Interactive list messages instead of numbered text; per-team broadcast.
4. Redis for guards/hub; queue (SQS) for webhook processing on Lambda.
5. Admin-side "message this person" tool and delivery-failure dashboard.

## 9. Troubleshooting
| Symptom | Check |
|---|---|
| Meta says "callback URL couldn't be validated" | Wrong URL (must be Render direct), `WHATSAPP_VERIFY_TOKEN` mismatch, API asleep/not redeployed |
| Messages arrive but nothing happens | `WHATSAPP_APP_SECRET` missing/wrong (401 in logs); webhook not subscribed to `messages` |
| Bot says "not linked" | Code expired (15 min) or sent from a different number than intended |
| No alerts when idle > 24 h | Template not approved / `WHATSAPP_TEMPLATE_NOTIFY` unset |
| MCP 401 | Token revoked/expired, missing `Bearer ` prefix |
| MCP tool "permission" error | Working as designed: the user's role can't do that in the web app either |
| Settings shows MCP URL on the wrong host | Set `PUBLIC_API_URL` to the Render URL |
