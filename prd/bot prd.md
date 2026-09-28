# PRD — Telegram Group Deposit Bot (`subnpaybackend`)

## 1. Overview

A Telegram bot that treats each Telegram **group as a wallet/member**. A group is allowlisted via env, registers itself with `/reg`, receives deposits via `/deposit` using the existing SimplyPay INR deep link, and can query its balance and deposit statistics.

### 1.1 The identity rule

> **The Telegram `groupId` is the member identifier. It is the only identity in this system.**

- Membership, wallets, balances, orders, and stats are all keyed on `groupId`. There is no numeric `userid`, no `User` document, and no per-human wallet anywhere in the bot path.
- The `TelegramGroup` document *is* the member record. Creating it is "member creation."
- `registeredBy` and `requestedBy` on `TelegramGroup` / `BotOrder` are **audit-only** — they record which human happened to type the command. They are never used to look up a wallet, authorize a balance, join a query, or scope an aggregate. Changing them changes nothing about the money.
- Consequence: a human who is in three allowlisted groups holds three independent wallets. Balances do not follow a person between groups. This is intended.
- `TELEGRAM_OWNER_ID` is the single exception, and it is a *permission* not an *account* — it gates who may operate the bot and who receives alerts. It owns no wallet.

**Explicitly out of scope of the existing auth system:** the bot has no relation to `User`, `mobile`, `password`, `userid`, or JWT. No login, no OTP, no linking to web users.

**Out of scope:** withdrawals/spending. Balance accumulates; a `/withdraw` flow will be designed later.

## 2. Goals

| # | Goal |
|---|---|
| G1 | Allowlisted groups self-register via `/reg` and immediately receive a group id + balance |
| G2 | Any member of a registered group can read that group's balance via `/balance` |
| G3 | Any member can create a deposit via `/deposit <amount>` and get a UPI id + amount back from the SimplyPay deep link |
| G4 | Per-group daily stats (`/daily`): that group's total orders, total amount, success, pending, failed — today (IST) as the headline, all-time as context |
| G5 | Any command attempt from a non-allowlisted chat or user is denied and the owner is DM'd the offending chat id, user id, and command |
| G6 | A REST API to inspect groups, orders, stats, and manually adjust balances |

## 3. Non-Goals

- Withdrawals / payouts / spending group balance
- **Bonuses and commissions on group deposits** — bot deposits are credited at face value. `BonusConfig` and `creditCommission` (the web flow's bonus + upline commission) are deliberately **not** applied; groups have no bonus config and no upline.
- Mapping Telegram users to existing `User` records
- Per-member (individual human) wallets — the group is the wallet
- USDT/crypto deposits — INR via SimplyPay only
- Bot-driven admin UI in Telegram (admin ops happen over REST)

## 4. Environment Variables

New (all read in one `services/bot/config.js` with validation at boot):

```ini
# Bot identity
TELEGRAM_BOT_TOKEN=<paste-token-from-@BotFather>   # never commit a real token
TELEGRAM_OWNER_ID=<owner-numeric-telegram-user-id>
TELEGRAM_BOT_USERNAME=subnpay_bot          # optional, for deep links

# Authority allowlist — comma-separated group ids permitted to /reg
TELEGRAM_ALLOWED_GROUP_IDS=-1001234567890,-1009876543210

# Deposit limits (INR)
BOT_MIN_DEPOSIT_AMOUNT=100
BOT_MAX_DEPOSIT_AMOUNT=100000

# Webhook that credits bot deposits
SIMPLYPAY_BOT_NOTIFY_URL=https://subnpaybackend.onrender.com/webhook/simplypay/bot

# Kill switch + transport
BOT_ENABLED=true
BOT_MODE=polling                            # polling | webhook
BOT_WEBHOOK_URL=https://subnpaybackend.onrender.com/bot/telegram/<secret>   # webhook mode only
BOT_WEBHOOK_SECRET=<long random string>     # webhook mode only, required

# SimplyPay status code(s) meaning "expired". Empty by default on purpose - see
# section 9. Set the confirmed code(s), comma-separated, e.g. 4,-5
SIMPLYPAY_EXPIRED_STATUSES=
```

Boot behaviour: if `BOT_ENABLED !== 'true'`, the bot does not start. If `TELEGRAM_BOT_TOKEN` or `TELEGRAM_OWNER_ID` is missing while enabled, log a fatal error and refuse to start (fail loud, not silent). `SIMPLYPAY_BOT_NOTIFY_URL` is also required while enabled and must point at `/webhook/simplypay/bot` — it deliberately does **not** fall back to `SIMPLYPAY_NOTIFY_URL`, because that path is served by `simplypayController`, which looks up `Payin` by `payinId`, finds nothing, and silently discards the payment.

In `webhook` mode Telegram POSTs updates to `/bot/telegram/:secret`; the secret is compared before the update reaches the bot, since an open update endpoint would let anyone POST forged updates and run `/reg` or `/deposit` as any chat.

## 5. Data Models

Three new models. **None** touch `User`, `Payin`, or `Transaction` — the bot is a separate ledger.

### 5.1 `models/TelegramGroup.js` — the member

```js
{
  groupId:              { type: String, required, unique, index },   // "-1001234567890"
  title:                { type: String, default: '' },
  username:             { type: String, default: null },            // public @handle
  type:                 { type: String, enum: ['group','supergroup','private'], default: 'supergroup' },
  status:               { type: String, enum: ['active','banned'], default: 'active', index },
  registeredBy:         { type: Number, default: null },            // AUDIT ONLY — see §1.1
  registeredByUsername: { type: String, default: '' },              // AUDIT ONLY
  lastActiveAt:         { type: Date, default: null },
  totalDeposits:        { type: Number, default: 0 },               // successful order count
  totalCredited:        { type: Decimal128, default: 0, get: decimalGetter },
  totalFailed:          { type: Number, default: 0 }
}
```

Indexes: unique `{ groupId: 1 }`, `{ status: 1 }`, `{ createdAt: -1 }`, `timestamps: true`.

### 5.2 `models/BotOrder.js` — a deposit order

```js
{
  orderId:              { type: String, unique, index, required },  // generateOrderId('B')
  group:                { type: ObjectId, ref: 'TelegramGroup', required, index },
  groupId:              { type: String, index },
  amount:               { type: Decimal128, required, get: decimalGetter },
  receivedAmount:       { type: Decimal128 },                       // always === amount (no bonus)
  currency:             { type: String, enum: ['INR'], default: 'INR' },
  network:              { type: String, default: 'SPAY' },
  status:               { type: String, enum: ['pending','success','failed','expired','reversed'],
                          default: 'pending', index },
  upiId:                { type: String, default: null },            // `pa` parsed out of deepLink
  deepLink:             { type: String, default: null },            // upi://pay?pa=...&am=...
  paymentLink:          { type: String, default: null },            // https:// gateway fallback
  simplypayOrderNo:     { type: String, default: null, index },
  trnId:                { type: String, default: null, index },     // BotTransaction on credit
  requestedBy:          { type: Number, default: null },            // AUDIT ONLY — see §1.1
  requestedByUsername:  { type: String, default: '' },              // AUDIT ONLY
  remark:               { type: String, default: '' },
  paidAt:               { type: Date, default: null }
}
```

Indexes: unique `{ orderId: 1 }`, `{ group: 1, status: 1 }`, `{ group: 1, createdAt: -1 }`, `{ status: 1, createdAt: -1 }`, `timestamps: true`.

### 5.3 `models/BotTransaction.js` — the balance ledger

Mirrors the existing `Transaction` pattern. **Group balance = `balanceAfter` of the most recent `status: 'success'` row, else 0.**

```js
{
  trnId:        { type: String, unique, index, required },          // generateOrderId('BTXN')
  group:        { type: ObjectId, ref: 'TelegramGroup', required, index },
  groupId:      { type: String, index },
  order:        { type: ObjectId, ref: 'BotOrder', default: null, index },
  orderId:      { type: String, default: null, index },
  amount:       { type: Decimal128, required, get: decimalGetter },
  type:         { type: String, enum: ['credit','debit'], default: 'credit' },
  note:         { type: String, enum: ['deposit','adjustment','reversal'], default: 'deposit' },
  balanceAfter: { type: Decimal128, required, get: decimalGetter },
  status:       { type: String, enum: ['success','reversed'], default: 'success', index },
  createdBy:    { type: Number, default: null },                    // admin userid who adjusted — AUDIT ONLY
  remark:       { type: String, default: '' }
}
```

Indexes: unique `{ trnId: 1 }`, `{ group: 1, status: 1 }`, `{ group: 1, createdAt: -1 }`, `timestamps: true`.

## 6. Command Specification

All handlers live in `services/bot/handlers/`. Every command runs through the guard (§7) first. Group-scoped commands only work in group/supergroup chats.

### 6.1 `/start` — onboarding

- Allowlisted, unregistered → `This group is allowlisted. Run /reg to activate its wallet.`
- Not allowlisted → denied + owner alert
- Registered → group id, balance, and the command list

### 6.2 `/reg` — create the member (the group)

`/reg` is member creation. The row it writes is the member, keyed on `groupId`. There is no `userid` and no `User` document involved.

| Case | Behaviour |
|---|---|
| Chat id **not** in `TELEGRAM_ALLOWED_GROUP_IDS` | Reply `This group is not authorised to use the bot.` + **owner alert** |
| Already registered & active | Idempotent — return the same payload as first registration, with `alreadyRegistered: true` |
| Banned | Reply `This group is blocked.` + **owner alert** |
| Valid | Upsert `TelegramGroup` on `groupId` with `status: 'active'`, `title`, `username`; set `registeredBy` / `registeredByUsername` for audit |

The `groupId` in the message is the sole key — `upsert` matches on `groupId` alone. A second `/reg` from the same group updates the title/username and nothing else; it never creates a second member.

**Response (first registration):**

```
✅ Group Registered

Group ID      : -1001234567890
Group Title   : SubnPay Deposits
Balance       : ₹0.00
Registered At : 2026-09-28 10:15 IST
Registered By : @adminuser (987654321)

Commands:
/balance  - Check group balance
/deposit  - Create a deposit
/daily    - Deposit statistics
```

`Registered By` is audit information about who typed the command. The member itself is the `Group ID` line — that is the identifier every later command, query and balance lookup uses.

Returns HTTP-equivalent payload `groupId`, `title`, `username`, `balance`, `registeredAt`, `status`, `alreadyRegistered`.

### 6.3 `/balance` — group balance

Private-chat variant (`/balance <groupId>`) is owner/admin only, so support can answer DMs.

```
💰 Group Balance

Group ID        : -1001234567890
Balance         : ₹12,500.00
Total Credited  : ₹25,000.00
Successful Orders : 7
Failed Orders      : 1
Pending Orders     : 2
```

### 6.4 `/deposit <amount>` — create a deposit

Argument parsing: `/deposit 400`, `/deposit 400.50`. Currency symbols, commas, and `/deposit` with no value are rejected with a usage hint.

1. Guard passes.
2. `amount = Number(raw)`. Reject if `!Number.isFinite(amount) || amount <= 0` → `Invalid amount.`
3. Reject if `amount < BOT_MIN_DEPOSIT_AMOUNT` → `Minimum deposit is ₹100.`
4. Reject if `amount > BOT_MAX_DEPOSIT_AMOUNT` → `Maximum deposit is ₹100000.`
5. Create `BotOrder` (`orderId = generateOrderId('B')`, `status: 'pending'`, `amount`, `receivedAmount = amount`). **No bonus is applied** — `BonusConfig` is not read on this path, and `creditCommission` is never called, so a group deposit credits face value and creates no upline commission.
6. `simplypay.createPaymentOrder({ merOrderNo: orderId, amount, notifyUrl: process.env.SIMPLYPAY_BOT_NOTIFY_URL, attach: 'botdeposit_<orderId>', extra: { name: 'Group Deposit', email: 'bot@subnpay', mobile: '9999999999' } })`
7. `code !== 0` → set order `status: 'failed'`, `remark: msg`, reply `Payment gateway error: <msg>`, and DM the owner.
8. Parse `data.params.deepLink` → `{ upiId, upiAmount, txnRef, note }` (§8). Persist `upiId`, `deepLink`, `paymentLink`, `simplypayOrderNo`.
9. Reply with inline keyboard:

```
💳 Deposit Requested

Order ID    : B20260928093925967924200
Group ID    : -1001234567890
Amount      : ₹400.00
UPI ID      : merchant@paytm
UPI Amount  : ₹400.00
Gateway Ref : 20250928093926
Status      : pending

[ 📲 Pay with UPI ]   ← inline button, url = deepLink
```

`Credited` is omitted from the reply because it always equals `Amount` — no bonus is involved.

If `upiId` cannot be parsed, still return the deep link + amount and note `UPI ID unavailable — use the payment link`, plus `data.params.paymentLink` as a second button.

### 6.5 `/daily` — that group's daily deposit statistics

Reports the deposit activity of the group it is invoked in. **Today (IST, midnight → now) is the headline block**; the all-time block is included as context below it. Visible to every member of the registered group.

Scoped strictly to the invoking group's `_id` — one group can never see another's numbers. The REST equivalent is `GET /api/bot/stats/:groupId?window=today|all`.

```
📊 Daily Report — -1001234567890 (SubnPay Deposits)

── Today (IST) ──────────────
Total Orders  : 12
Total Amount  : ₹18,400.00
✅ Success    : 9  (₹13,900.00)
⏳ Pending    : 2  (₹2,500.00)
❌ Failed     : 1  (₹2,000.00)

── All Time ────────────────
Total Orders  : 148
Total Amount  : ₹312,750.00
✅ Success    : 131 (₹276,400.00)
⏳ Pending    : 9   (₹21,350.00)
❌ Failed     : 8   (₹15,000.00)

Current Balance : ₹91,200.00
```

Optional args: `/daily today` (today block only), `/daily all` (all-time block only), `/daily` (both, as shown).

"Total Amount" = sum of `amount` across all orders in the window. `₹` formatting via `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.

**Today window** = midnight IST to now. Computed timezone-safe:

```js
const IST_MIN = 330;
function startOfIstDay(now = new Date()) {
  const ist = new Date(now.getTime() + IST_MIN * 60_000);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIst - IST_MIN * 60_000);
}
```

Implementation: one Mongo `$facet` aggregation over `BotOrder` filtered by `{ group, createdAt: { $gte: startOfIstDay() } }` and `{ group }`, with `$group` by `status` and `$sum` of `amount`. Two round-trips max, not N.

## 7. Authority Model & Owner Alerting

### 7.1 Allowlist parsing

`TELEGRAM_ALLOWED_GROUP_IDS` is comma-separated, trimmed, empty entries dropped. Parsed once at boot into a `Set<string>`. Support `-100…` and `@username` (resolved to an id via `getChat` on first use, then cached). Invalid entries log a warning at boot and are dropped.

### 7.2 Guard decision order

`resolveAuthority(ctx)` in `services/bot/guard.js` returns `{ allowed, reason, alert }`:

1. `from.id === TELEGRAM_OWNER_ID` → **allow** (`reason: 'owner'`). Owner bypasses the allowlist in DMs and groups.
2. `chat.type === 'private'` → **deny** (`reason: 'dm_not_allowed'`, alert).
3. `allowlist.has(String(chat.id))` → **allow** (`reason: 'allowlisted_chat'`). Works for allowlisted groups before they run `/reg` — the allowlist is the authority; `/reg` is what creates the wallet.
4. Otherwise → **deny** (`reason: 'chat_not_allowlisted'`, alert).

Group-level commands (`/balance`, `/deposit`, `/daily`) additionally require a `TelegramGroup` row with `status: 'active'`; otherwise reply `This group is not registered. Run /reg first.` (no owner alert — that is a normal, expected state).

### 7.3 Owner alert

Sent via `bot.sendMessage(TELEGRAM_OWNER_ID, ...)` with `parse_mode: 'HTML'`:

```
🚨 <b>Unauthorized bot access</b>

Chat ID       : -1009998887776
Chat Type     : supergroup
Chat Title    : Random Group
Chat Username : @randomgroup
User ID       : 5551234567
Username      : @someone
First Name    : Some
Command       : /deposit 500
Reason        : chat_not_allowlisted
Time (IST)    : 2026-09-28 10:15:00
```

The offending chat id and user id are both reported, as requested. Sent once per violating message.

**Dedupe:** a key of `chatId|userId|command` is cached for `BOT_ALERT_DEDUPE_MS` (default 5 min) to stop a spamming group from flooding the owner's DM. Suppressed attempts are counted and logged at `warn`. Alerts are best-effort — a failed alert DM is logged, never thrown into the command path.

### 7.4 Command routing

`node-telegram-bot-api` `on('message')`. Parse the command token and args, dispatch to a handler map. Unknown commands reply with a help block. Non-command messages are ignored in groups (avoids noise); in an allowlisted DM the owner gets a help hint.

## 8. UPI Deep Link Handling

`services/bot/upilink.js` — pure functions, unit-testable.

```js
// upi://pay?pa=merchant@paytm&pn=SubnPay&tr=REF123&am=400.00&cu=INR&tn=Deposit
parseUpiLink('upi://pay?pa=merchant@paytm&am=400.00&tr=REF123')
// => { upiId: 'merchant@paytm', upiAmount: 400.00, txnRef: 'REF123', note: ..., valid: true }
```

- Parsed with `new URL()`; `URLSearchParams` reads `pa` (VPA), `am` (amount), `tr` (gateway txn ref), `tn` (note), `pn` (payee name).
- `valid: false` when `pa` is missing or not matching `/^[\w.\-]{1,256}@[\w.\-]{1,64}$/`.
- If `am` is absent, fall back to the requested order amount.
- If `deepLink` is absent from the gateway response entirely, fall back to `paymentLink` and mark the order `remark: 'No upi deep link; gateway web link only'`.

## 9. Deposit Settlement (Webhook)

New unauthenticated route: `POST /webhook/simplypay/bot` → `controllers/botWebhookController.botPayinCallback`.

1. `simplypay.verifySign(req.body)` → mismatch logs a warning and returns `200 { success: true }` (never 4xx; the gateway would retry).
2. `merOrderNo` → `BotOrder.findOne({ orderId })`. Missing → `200`.
3. `BotOrder.findOneAndUpdate({ orderId, status: 'pending' }, { $set: {...} }, { returnDocument: 'after' })` — **atomic claim**. If it returns `null`, another webhook already handled it → `200`. This is the double-credit guard.
4. `orderStatus` handling, matching the existing `payinCallback` mapping:

| `orderStatus` | Action |
|---|---|
| `2`, `3` (success) | Credit balance + post group message |
| `-1`, `-2` (failed) | Mark failed + post group message |
| configured expired code(s) | Mark `expired` + post group message. **The gateway is the only thing that can expire an order** |
| `0`, `1` (pending) | No-op, `200` |
| anything else | No-op, `200`, log at `warn` with the raw code |

**Expiry rule:** there is no client-side or server-side timeout. An order stays `pending` until SimplyPay itself reports it as expired. No cron job, no TTL index, no `expiresAt` field, and no admin-side auto-cancel. This means a SimplyPay order that is never paid and never expired will keep sitting in the `pending` count on `/daily` — that is the intended behaviour, and it is why the `⏳ Pending` figure is reported as a raw count rather than treated as a problem. Admin can still force-close one via `POST /api/bot/orders/:orderId/reject`.

**The expired status code is configuration, not a guess.** `SIMPLYPAY_EXPIRED_STATUSES` is a comma-separated list that is **empty by default**. `-4` is listed as PENDING in the SimplyPay status table in `services/simplypay.apidoc.md`, which documents no expired code at all, and the existing `payinCallback` treats `-4` as neither success nor failure. Hardcoding `-4` as expired would mark a live payment expired and never credit it — a silently lost deposit. Until the real code is confirmed with the gateway, an unknown code leaves the order `pending`, which is recoverable. Set the confirmed code(s) in `.env` to enable the `expired` state.

**Atomicity:** the success path runs the claim, the ledger write, the group totals, and the `trnId` back-link inside a single MongoDB transaction (`session.withTransaction`, `controllers/botWebhookController.settleSuccess`). Claiming the order and writing the ledger as two separate writes would leave an order marked `success` with no credit if the process died in between, and every later gateway retry would then be rejected as "already success" — money lost with no automatic recovery. `creditGroup` therefore requires a session and throws without one.

**Concurrency:** the transaction also writes the `TelegramGroup` document, which is what makes two concurrent deposits for the same group conflict and retry rather than both reading the same latest `balanceAfter` and writing the same new balance. Verified by `tests/settlement.integration.cjs`.

**Crediting** (in `services/botGroupService.creditGroup`):

```js
const current  = await getGroupBalance(group._id);           // latest success balanceAfter, else 0
const credited = parseBalance(order.receivedAmount ?? order.amount);   // face value, no bonus
await BotTransaction.create({
  trnId: generateOrderId('BTXN'), group: group._id, groupId: group.groupId,
  order: order._id, orderId: order.orderId,
  amount: credited, type: 'credit', note: 'deposit',
  balanceAfter: current + credited, status: 'success',
});
await TelegramGroup.updateOne({ _id: group._id }, {
  $inc: { totalDeposits: 1, totalCredited: credited },
  $set: { lastActiveAt: new Date() },
});
```

`note: 'deposit'` and `type: 'credit'` are the only two reasons a group balance grows. There is no bonus leg and no commission leg — `BonusConfig` and `creditCommission` are never touched from the bot path.

**Group notification** (new behaviour, required for the flow to be usable — flagging explicitly):

```
✅ Deposit Successful

Order ID  : B20260928093925967924200
Amount    : ₹400.00
Credited  : ₹400.00
Balance   : ₹12,900.00
```

Sent with `bot.sendMessage(group.groupId, ...)`. Failures are logged, never thrown — the webhook must still return `200`.

Always responds `200 { success: true }`.

## 10. REST API

New router `routes/bot.js` mounted at `/api/bot` in `index.js`. Reuses existing `auth` + `requireAdmin` middleware and the `{ success: true, ... }` / `{ success: 'failed', msg }` envelope. Bot group ids go in the path, so Express 5 handles the negative-number string fine.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bot/groups` | List registered groups — `?status&page&limit` |
| `GET` | `/api/bot/groups/:groupId` | Group detail + current balance + last 10 orders |
| `PATCH` | `/api/bot/groups/:groupId/status` | `{ status: 'active' \| 'banned' }` |
| `POST` | `/api/bot/groups/:groupId/adjust` | `{ amount, type: 'credit'\|'debit', remark }` → creates a `note: 'adjustment'` BotTransaction. Guards against negative resulting balance. |
| `GET` | `/api/bot/orders` | List orders — `?groupId&status&from&to&page&limit` |
| `GET` | `/api/bot/orders/:orderId` | Order detail + its BotTransaction if credited |
| `POST` | `/api/bot/orders/:orderId/approve` | Manually credit a stuck `pending` order (same atomic claim + credit path as the webhook) |
| `POST` | `/api/bot/orders/:orderId/reject` | Mark `pending` → `failed` |
| `GET` | `/api/bot/stats/:groupId` | `?window=today\|all` → same shape as `/daily` |
| `GET` | `/api/bot/health` | Bot connected?, transport mode, registered group count (no auth — mirrors existing `/` health check) |

All admin routes: `auth, requireAdmin`. Errors follow the existing pattern: `throw new Error(msg); err.status = 400;` in services, mapped in controllers.

## 11. Architecture

```
models/TelegramGroup.js
models/BotOrder.js
models/BotTransaction.js

services/bot/config.js          env parsing + allowlist Set + validation
services/bot/client.js          node-telegram-bot-api instance, start/stop
services/bot/guard.js           resolveAuthority() + alertOwner()
services/bot/commands.js        message dispatcher
services/bot/upilink.js         parseUpiLink()
services/bot/handlers/reg.js
services/bot/handlers/balance.js
services/bot/handlers/deposit.js
services/bot/handlers/daily.js
services/bot/stats.js           getGroupStats() aggregation

services/botGroupService.js     getGroupBalance, creditGroup, adjustGroup, registerGroup
                               (mirrors services/payinService.js placement)

controllers/botController.js         REST API
controllers/botWebhookController.js  POST /webhook/simplypay/bot
routes/bot.js                        /api/bot
```

**`index.js` integration** — start the bot only after the DB is connected, and shut it down cleanly:

```js
connectDB().then(() => startBot());
process.on('SIGTERM', stopBot);
process.on('SIGINT', stopBot);
```

`startBot` wraps in try/catch and logs a fatal error without crashing the HTTP server (the API must stay up even if the bot is down).

**Dependency:** add `node-telegram-bot-api` to `package.json`. It is CommonJS, matching this codebase.

**Transport decision:** default `polling` for simplicity. `webhook` mode is required if the host has aggressive idle timeouts (Render free tier spins down and a long-poll connection dies silently). Documented as a deployment consideration, with `BOT_MODE` as the switch.

## 12. Error Handling

- Every command handler is wrapped in try/catch; failures reply with a user-safe message and log via `pino` (`logger.error({ err, command, chatId, userId }, 'bot command failed')`). No stack traces to Telegram.
- Gateway errors reply with the gateway message **and** alert the owner (a failing gateway is an ops issue).
- Handler exceptions never crash the process; `client.on('polling_error')` is logged.

## 13. Security

- `TELEGRAM_BOT_TOKEN` never logged, never returned by any endpoint.
- Group id is the only identifier used for money; `/balance <groupId>` in a private chat is owner/admin only, so balance cannot be probed by arbitrary users.
- Telegram group ids are not secret, but a group's balance is only readable from inside that group.
- Owner alerts include user-supplied names/usernames — escape HTML for `parse_mode: 'HTML'` (`& < >`) before interpolating `title`/`username`/`firstName`.
- All admin REST routes behind existing JWT + `requireAdmin`.
- Balance adjustments are ledger rows with `createdBy` + mandatory `remark`; balance can never go negative (service-level check).

## 14. Testing

Vitest, matching the existing pure-unit convention (`tests/*.test.js`, ESM `import` syntax, no DB):

- `tests/upilink.test.js` — full UPI URI, missing `am`, missing `pa`, malformed VPA, non-`upi` scheme, empty string
- `tests/botAmount.test.js` — below min, above max, exact bounds, `NaN`, zero, negative, `"400.50"` string, `"1,000"` rejection
- `tests/botGuard.test.js` — allowlisted group, owner in DM, owner in non-allowlisted group, private DM from stranger, public group not in allowlist, empty/malformed allowlist env
- `tests/botStats.test.js` — `startOfIstDay` across UTC/IST midnight boundaries, leap/month/year boundaries, all-time bucket
- `tests/botFormat.test.js` — `Intl.NumberFormat('en-IN')` currency output, stats block rendering

Integration tests against a real DB are out of scope for `npm test` (would need `mongodb-memory-server`, a new dev dependency), so the two highest-risk surfaces are covered separately:

- `tests/requireAll.cjs` — runs under plain `node` before vitest (`npm test:modules`). Vitest resolves imports with Vite, which is more forgiving than Node; a wrong relative path in a handler passed the whole vitest suite and then crashed at runtime with `Cannot find module`. This catches that class of bug.
- `tests/settlement.integration.cjs` — hits the real database and asserts the money path: single settlement credits face value; a replayed callback does not double-credit; **two concurrent settlements for one group both land** (no lost update); a simulated crash mid-transaction leaves the order `pending` with no ledger row; and a retry after that crash succeeds. Run with `node tests/settlement.integration.cjs`. It requires a replica set, since settlement uses multi-document transactions.

The webhook signature path is still only manually verified — recommend a real SimplyPay sandbox order before production.

## 15. Acceptance Criteria

1. Boot with `BOT_ENABLED=true` and a valid token → `bot connected` logged; `/api/bot/health` reports connected.
2. Allowlisted group runs `/reg` → reply contains the group id, title, `₹0.00` balance, and the command list; a `TelegramGroup` row exists with `status: 'active'`.
3. `/reg` again on the same group → same payload plus `alreadyRegistered: true`; no duplicate row.
4. A **non**-allowlisted group runs `/reg` → denied message, and the owner receives a DM containing that group id, the user id, and the command.
5. A stranger DMs `/balance` → denied, owner alerted with their user id.
6. Registered group runs `/balance` → returns the group's ledger balance.
7. `/deposit 400` → order row `pending`; reply shows the UPI id, the amount, and a working **Pay with UPI** button pointing at the `upi://` deep link.
8. `/deposit 50` (below min) and `/deposit 99999999` (above max) → rejected with the configured bound; **no** order row and **no** gateway call.
9. SimplyPay success webhook for that order → `BotOrder.status = 'success'`, one `BotTransaction` with correct `balanceAfter`, group totals incremented, and a success message posted in the group.
10. The same webhook replayed → no second `BotTransaction`, no balance change.
11. Gateway failure webhook → order `failed`, failure message in the group, balance unchanged.
12. No cron, no TTL, no `expiresAt` on `BotOrder` — an abandoned order stays `pending` indefinitely until SimplyPay reports it expired. Verified by waiting 24h+ on a test order and confirming the status is still `pending` and still counted in `/daily`.
13. `/daily` → today and all-time blocks, each with total orders, total amount, and success/pending/failed counts and sums, scoped to the invoking group. Group A's `/daily` must not reflect any order from group B.
14. A `₹400` deposit credits exactly `₹400` even when an active `BonusConfig` would grant a bonus — no bonus leg in the ledger, and no `Commission` record is created for the group.
15. `GET /api/bot/stats/:groupId?window=all` without a JWT → 401; with an admin JWT → 200 matching the Telegram numbers.
16. `POST /api/bot/groups/:groupId/adjust` with a debit exceeding balance → 400, no ledger row, balance unchanged.
17. Alert de-dupe → 10 `/reg` attempts from the same non-allowlisted group within 5 minutes produce exactly 1 owner DM.
18. Identity is group-only: after `/reg`, mutating `registeredBy` to a different Telegram user id changes no balance, no order, no stat, and no permission. `grep` the bot source for `userid` and confirm it appears only in comments and in the unrelated admin-JWT path.

## 16. Open Questions

Resolved during drafting (recorded for traceability):

- ~~**Bonus on bot deposits**~~ → **No bonus.** Group deposits credit face value. `BonusConfig` and `calculateBonus` are not used on the bot path; `bonusAmount` has been dropped from `BotOrder`.
- ~~**`/daily` scope**~~ → **That group's daily stats**, today (IST) as the headline plus all-time for context, visible to every member of the registered group.
- ~~**Commission on group deposits**~~ → **None.** `creditCommission` is never called from the bot path; groups have no upline.
- ~~**Deposit expiry**~~ → **Gateway-driven only.** An order expires exclusively when SimplyPay reports it expired. No cron, no TTL, no `expiresAt`. Stale `pending` orders persist and remain visible in the `/daily` pending count. `expired` added to the `BotOrder` status enum.
- ~~**Multi-group isolation**~~ → **Per group, by design.** The `groupId` is the member identifier (§1.1). A human in three allowlisted groups holds three independent wallets; balances never follow a person between groups. `registeredBy` / `requestedBy` are audit-only and are never used for wallet lookup or authorization.

Still open:

1. **Admin route auth** — assumed the existing admin JWT/role. If support staff need it, they'd need `role: 'admin'` on a web `User`, which conflicts with the bot being independent of that system. Consider a separate `BOT_API_KEY` header instead.
2. **SimplyPay expired status code** — the local apidoc lists `-4` as PENDING, not expired. Confirm the real code before implementation; if none exists, `expired` collapses into `failed`.
