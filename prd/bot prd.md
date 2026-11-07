# PRD — Telegram Group Deposit Bot (`subnpaybackend`)

## 1. Overview

A Telegram bot that treats each Telegram **group as a wallet/member**. The bot owner registers a group with `/reg`; any member of an active registered group can create deposits via `/d` using the existing SimplyPay INR deep link and query that group's balance and deposit statistics.

### 1.1 The identity rule

> **The Telegram `groupId` is the member identifier. It is the only identity in this system.**

- Membership, wallets, balances, orders, and stats are all keyed on `groupId`. There is no numeric `userid`, no `User` document, and no per-human wallet anywhere in the bot path.
- The `TelegramGroup` document *is* the member record. Creating it is "member creation."
- `registeredBy` and `requestedBy` on `TelegramGroup` / `BotOrder` are **audit-only** — they record which human happened to type the command. They are never used to look up a wallet, authorize a balance, join a query, or scope an aggregate. Changing them changes nothing about the money.
- Consequence: a human who is in three groups holds three independent wallets. Balances do not follow a person between groups. This is intended.
- `TELEGRAM_OWNER_ID` is the single exception, and it is a *permission* not an *account* — it gates who may operate the bot and who receives alerts. It owns no wallet.

**Explicitly out of scope of the existing auth system:** the bot has no relation to `User`, `mobile`, `password`, `userid`, or JWT. No login, no OTP, no linking to web users.

**Out of scope:** withdrawals/spending. Balance accumulates; a `/withdraw` flow will be designed later.

## 2. Goals

| # | Goal |
|---|---|
| G1 | The bot owner registers a group via `/reg`, which immediately receives a group id + balance |
| G2 | Any member of a registered group can read that group's balance via `/balance` |
| G3 | Any member can create a deposit via `/d <amount>` and get a UPI id + amount back from the SimplyPay deep link |
| G4 | Per-group daily stats (`/daily`): that group's total orders, total amount, success, pending, failed — today (IST) as the headline, all-time as context |
| G5 | Any member can check one order with `/status <order id>`: order id, amount, status, created time, and the success time once credited |
| G6 | Group commands are available to any member of that registered, active group and always operate on that group's data; private DMs from strangers are denied |
| G7 | A REST API to inspect groups, orders, stats, and manually adjust balances |

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

# Legacy setting; group access is determined by registration and active status.
TELEGRAM_ALLOWED_GROUP_IDS=

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

In `webhook` mode Telegram POSTs updates to `/bot/telegram/:secret`; the secret is compared before the update reaches the bot, since an open update endpoint would let anyone POST forged updates and run commands as any chat.

## 5. Data Models

Three new models. **None** touch `User`, `Payin`, or `Transaction` — the bot is a separate ledger.

### 5.1 `models/TelegramGroup.js` — the member

```js
{
  groupId:              { type: String, required, unique, index },   // "-1001234567890"
  uid:                  { type: String, unique, sparse, match: /^\d{5}$/ }, // public code: "32045"
  title:                { type: String, default: '' },
  username:             { type: String, default: null },            // public @handle
  type:                 { type: String, enum: ['group','supergroup','private'], default: 'supergroup' },
  status:               { type: String, enum: ['active','banned','suspended'], default: 'active', index },
  statusRemark:         { type: String, default: '' },               // reason for the latest moderation change
  statusUpdatedAt:      { type: Date, default: null },
  statusUpdatedBy:      { type: Number, default: null },             // admin userid — AUDIT ONLY
  statusHistory:        [{ status, remark, changedBy, changedAt }],  // full moderation audit trail
  registeredBy:         { type: Number, default: null },            // AUDIT ONLY — see §1.1
  registeredByUsername: { type: String, default: '' },              // AUDIT ONLY
  lastActiveAt:         { type: Date, default: null },
  totalDeposits:        { type: Number, default: 0 },               // successful order count
  totalCredited:        { type: Decimal128, default: 0, get: decimalGetter },
  totalFailed:          { type: Number, default: 0 }
}
```

Indexes: unique `{ groupId: 1 }`, unique sparse `{ uid: 1 }`, `{ status: 1 }`, `{ createdAt: -1 }`, `timestamps: true`.

`uid` is the public 5-digit member code, generated at registration from the range `10000–99999` and retried on the (rare) collision. It is a support/panel handle only: money, authorization and every aggregate stay keyed on `groupId`. It is sparse so groups created before the field existed can be backfilled; `backfillGroupUids()` runs after DB connect and assigns one to every group that lacks it.

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
  direction:            { type: String, enum: ['credit','debit'], default: 'credit' },
                          // debit = manual withdrawal adjustment only; deposit
                          // stats filter on it so money out never counts as a deposit
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

Indexes: unique `{ orderId: 1 }`, `{ group: 1, status: 1 }`, `{ group: 1, createdAt: -1 }`, `{ groupId: 1, createdAt: -1 }`, `{ status: 1, createdAt: -1 }`, `timestamps: true`.

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

Indexes: unique `{ trnId: 1 }`, `{ group: 1, status: 1 }`, `{ group: 1, createdAt: -1 }`, `{ groupId: 1, createdAt: -1 }`, `{ status: 1, createdAt: -1 }`, `timestamps: true`.

## 6. Command Specification

All handlers live in `services/bot/handlers/`. Every command runs through the guard (§7) first. Group-scoped commands only work in group/supergroup chats.

**Blocked groups.** A group whose `TelegramGroup.status` is `banned` or `suspended` cannot run group-scoped commands. The bot replies with the corresponding support-contact message. `/reg` is owner-only and cannot reactivate a blocked group; moderation state is set only through the admin REST API (§10). Settlement webhooks still process, so money already in flight is never lost when a group is blocked.

**Command menus (`/`)** — on startup the bot calls `setMyCommands` for two scopes:

| Scope | Commands shown |
|---|---|
| `all_group_chats` | `/start`, `/balance`, `/d`, `/status`, `/daily` — **`/reg` is not listed** |
| `chat` = `TELEGRAM_OWNER_ID` | `/start`, `/reg`, `/info` |

So in any group, typing `/` lists only the member commands; a normal user is never shown owner commands. `/reg` appears only in the owner's private chat, where it replies `Run /reg inside the group you want to register.` The owner must then run `/reg` in the target group; other members cannot register groups. `/info <message>` is also owner-DM-only and broadcasts the supplied text to every active registered group, reporting successful and failed deliveries. The group help block omits owner commands; only the owner's DM help includes them. `setMyCommands` is best-effort: a failure (e.g. the owner has never started the bot, so the chat does not exist yet) is logged and never blocks startup, and re-publishing runs on the next restart.

### 6.1 `/start` — onboarding

- Unregistered → `This group is authorised. Run /reg to create its wallet.`
- Registered → group id, balance, and the command list

### 6.2 `/reg` — create the member (the group)

`/reg` is owner-only member creation. The owner must run it inside the target group. The row it writes is the member, keyed on `groupId`; there is no `userid` and no `User` document involved. The owner's Telegram ID authorizes registration only; it does not own the group's wallet.

| Case | Behaviour |
|---|---|
| Sender is not `TELEGRAM_OWNER_ID` | Deny with `Only the bot owner can register a group.` |
| Already registered & active (owner runs `/reg`) | Idempotent — return the same payload as first registration, with `alreadyRegistered: true` |
| Banned | Reply `This group is banned. Please contact support for further help.` + **owner alert** |
| Suspended | Reply `This group is suspended. Please contact support for further help.` + **owner alert** |
| Valid | Upsert `TelegramGroup` on `groupId` with `status: 'active'`, a generated 5-digit `uid`, `title`, `username`; set `registeredBy` / `registeredByUsername` for audit |

The `groupId` in the message is the sole key — `upsert` matches on `groupId` alone. A second `/reg` from the same group updates the title/username and nothing else; it never creates a second member.

**Response (first registration):**

```
Group registered

Group ID: -1001234567890
UID: 32045
Title: SubnPay Deposits
Balance: ₹0.00
Registered at: 2026-09-28 10:15 IST
Registered by: @adminuser (987654321)

Commands:
/balance - Check this group balance
/d <amount> - Create a deposit
/daily   - Deposit success rate (10m / 30m / 1h / today)
```

`Registered By` is audit information about who typed the command. The member itself is the `Group ID` line — that is the identifier every later command, query and balance lookup uses. `UID` is the short public code support and the admin panel can quote or search by; a second `/reg` returns the same code.

Returns HTTP-equivalent payload `groupId`, `uid`, `title`, `username`, `balance`, `registeredAt`, `status`, `alreadyRegistered`.

### 6.3 `/balance` — group balance

Private-chat variant (`/balance <groupId>`) is owner/admin only, so support can answer DMs.

```
Merchant balance:

Balance: 12,500.00
Deposit: 1,500.00
Frozen: 0.00
```

`Balance` is the live ledger balance (`balanceAfter` of the newest `status: 'success'` row). `Deposit` is the money that came in **today** (IST) — the `success.amount` of today's orders where `direction !== 'debit'`. A manual **credit** counts, a manual **debit** never does: it is money leaving the group, so it must not read as a deposit. `Frozen` is a fixed `0.00`: nothing in this system ever holds funds back, so it is not queried. Amounts are plain numbers with two decimals and no `₹`, unlike the `/daily` lines.

### 6.4 `/d <amount>` — create a deposit

Argument parsing: `/d 400`, `/d 400.50`. Currency symbols, commas, and `/d` with no value are rejected with a usage hint.

1. Guard passes.
2. `amount = Number(raw)`. Reject if `!Number.isFinite(amount) || amount <= 0` → `Invalid amount.`
3. Reject if `amount < BOT_MIN_DEPOSIT_AMOUNT` → `Minimum deposit is ₹100.`
4. Reject if `amount > BOT_MAX_DEPOSIT_AMOUNT` → `Maximum deposit is ₹100000.`
5. Create `BotOrder` (`orderId = generateOrderId('B')`, `status: 'pending'`, `amount`, `receivedAmount = amount`). **No bonus is applied** — `BonusConfig` is not read on this path, and `creditCommission` is never called, so a group deposit credits face value and creates no upline commission.
6. `simplypay.createPaymentOrder({ merOrderNo: orderId, amount, notifyUrl: process.env.SIMPLYPAY_BOT_NOTIFY_URL, attach: 'botdeposit_<orderId>', extra: { name: 'Group Deposit', email: 'bot@subnpay', mobile: '9999999999' } })`
7. `code !== 0` → set order `status: 'failed'`, `remark: msg`, reply `Payment gateway error: <msg>`, and DM the owner.
8. Parse `data.params.deepLink` → `{ upiId, upiAmount, txnRef, note }` (§8). Persist `upiId`, `deepLink`, `paymentLink`, `simplypayOrderNo`.
9. Reply with inline keyboard. The message body carries exactly three details — no header, no emoji, no status line:

```
Order ID: B20260928093925967924200
Amount to pay: ₹400.00
UPI ID: merchant@paytm

[ Copy amount ]
[ Copy UPI ID ]
[ Pay now ]     ← inline url button, only when the gateway returns an http(s) link
```

`Amount to pay` is the **deep-link amount** (`am` from `data.params.deepLink`), because that is the figure the UPI app prefills. The amount typed after `/d` is used only when the link carries no usable `am`. The order id and UPI id are wrapped in `<code>`, so tapping the value copies it as well (`copy_text` buttons, Bot API 7.11+). "Copy amount" copies the plain number (`400.00`), without the `₹` or thousands separators. There is deliberately no "Copy order ID" button — the order id stays tap-to-copy text only.

`Pay now` is kept even though the body shows only three details: it is the only link that ties the payment back to `orderId`, and paying the bare UPI id does not produce a matching gateway callback.

If `upiId` cannot be parsed, the line reads `UPI ID: unavailable`, its copy button is omitted, and the keyboard falls back to `data.params.paymentLink` for the `Pay now` button.

### 6.4.1 `/osd <amount>` — owner-only OSPAY deposit

A second collection gateway for the bot owner only. It creates the **same `BotOrder` record and credits the same group wallet** as `/d`; only `network: 'OSPAY'` and the gateway call differ.

- **Owner only**: any other sender gets `Only the bot owner can use this command.`
- Group only, and the group must be registered/active like `/d`.
- **Whole-number amounts only** (`/osd 500`). OSPAY explicitly forbids decimals, so `/osd 500.50` is rejected.
- Flow: create `BotOrder` (`network: 'OSPAY'`, `status: 'pending'`) → `ospay.createPaymentOrder({ orderId, amount })` → persist `upiId` (`upi`), `paymentLink` (`data`), `gatewayOrderNo` (`order_code`) → reply with the normal deposit slip plus a `💳 Pay now` URL button.
- The 20-minute expiry edit and the `status : order completed 🟢` success edit work exactly as they do for `/d`.
- Gateway error: order is marked `failed`, the owner is alerted, and the group gets a plain error reply.

**Webhook** — `POST /webhook/ospay/bot`, `application/x-www-form-urlencoded`.

1. Verify `sign` with `OSPAY_MERCHANT_KEY` using the doc's `UPPERCASE(md5(sorted k=v & key=merchant_key))` over `mer_id, order_id, status, amount, realpay`.
2. `status: OK` → atomic `settleSuccess()` → `BotTransaction` credit → group totals → success notice (`PAYIN🔻`) → completed slip edit.
3. `status: error` → mark `failed`, increment `totalFailed`, send the failed notice.
4. Reply with the literal text `ok`; anything else makes OSPAY retry. A duplicate callback is a no-op because the order is claimed atomically.

Environment:

```env
OSPAY_MERCHANT_ID=
OSPAY_MERCHANT_KEY=
OSPAY_BASE_URL=https://ospayi.top
OSPAY_GATEWAY=1001
OSPAY_CALLBACK_URL=https://<domain>/
OSPAY_NOTIFY_URL=https://<domain>/webhook/ospay/bot
```

### 6.5 `/daily` — that group's success rate

Reports the deposit success rate of the group it is invoked in across four windows, newest first: the last 10 minutes, 30 minutes, 1 hour, and today (IST). Visible to every member of the registered group. All four lines are always shown, so there is no `today` / `all` argument anymore.

Scoped strictly to the invoking group's `_id` — one group can never see another's numbers. The REST equivalent is `GET /api/bot/stats/:groupId?window=today|all`.

```
😭 10 min: 3/5=60.00% ₹1,500.00
😭 30 min: 7/12=58.33% ₹4,200.00
😭 1 hour: 12/20=60.00% ₹8,900.00
😭 Today: 9/12=75.00% ₹13,900.00
```

Each line is `succeeded/total=rate% ₹succeeded amount`: how many orders landed in that window, how many of them reached `status: 'success'`, the resulting success rate to two decimals, and the money those successes totalled. An empty window reads `0/0=0.00% ₹0.00`, never `NaN`.

Manual **debit** adjustments (`direction: 'debit'`) are excluded from all four windows — they are money leaving the group, so they add nothing to the total, to the numerator, or to the money figure. Manual credits count like any other order.

The `₹` formatting uses `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.

**Today window** = midnight IST to now. Computed timezone-safe:

```js
const IST_MIN = 330;
function startOfIstDay(now = new Date()) {
  const ist = new Date(now.getTime() + IST_MIN * 60_000);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIst - IST_MIN * 60_000);
}
```

Implementation: four parallel aggregations over `BotOrder`, one per window (`now - 10m`, `now - 30m`, `now - 60m`, `startOfIstDay()`), each filtered by `{ group, direction: { $ne: 'debit' }, createdAt: { $gte: since } }` with `$group` by `status` and `$sum` of `amount`. Group scope is part of every `$match`, so a group can only ever read its own rows.

### 6.6 `/status <order id>` — one deposit's status

Looks the order up by `orderId` **and** the invoking group's `groupId`, so a group can only see its own orders. An id from another group reads exactly like a missing id: `Order not found in this group.`

```
Order ID: B20260928093925967924200
Amount: ₹400.00
Status: pending
Created on: 31/10/2026, 16:14
```

When the order has been credited (`status: 'success'`), one extra line is appended with the settlement timestamp (`paidAt`, falling back to `updatedAt`):

```
Order ID: B20260928093925967924200
Amount: ₹400.00
Status: success
Created on: 31/10/2026, 16:14
Success on: 31/10/2026, 16:16
```

Times are IST (`formatIst`). `failed`, `expired` and `reversed` orders show no `Success on` line. `/status` with no argument replies `Usage: /status <order id>`. It is a group command, so it requires a registered, non-banned group like `/balance` and `/daily`.

## 7. Authority Model & Owner Alerting

### 7.1 Guard decision order

`resolveAuthority(ctx)` in `services/bot/guard.js` returns `{ allowed, reason, alert }`:

1. `from.id === TELEGRAM_OWNER_ID` → **allow** (`reason: 'owner'`), including private chat.
2. A non-owner private chat → **deny** (`reason: 'dm_not_allowed'`, alert).
3. Group chats proceed to command routing. `/reg` registers the group; group commands look up the record by Telegram `chat.id`, require it to exist and have `status: 'active'`, and use that record for all reads and writes. The sender's user id and `TELEGRAM_ALLOWED_GROUP_IDS` do not authorize or deny group commands.

An unregistered group receives `This group is not registered yet. Run /reg first.` for group-level commands. Banned or suspended groups receive the corresponding support-contact denial. These expected group-level denials do not generate an unauthorized-access alert.

Moderation is checked before dispatch: any existing group whose status is not `active` skips the handler, so it cannot create an order, read a balance, or query a status.

### 7.2 Owner alert

Sent via `bot.sendMessage(TELEGRAM_OWNER_ID, ...)` with `parse_mode: 'HTML'`:

```
Unauthorized bot access

Chat ID: -1009998887776
Chat type: supergroup
Chat title: Random Group
Chat username: @randomgroup
User ID: 5551234567
Username: @someone
First name: Some
Command: /d 500
Reason: dm_not_allowed
Time (IST): 2026-09-28 10:15:00
```

The offending chat id and user id are both reported. Sent once per unauthorized private-DM attempt.

**Dedupe:** a key of `chatId|userId|command` is cached for `BOT_ALERT_DEDUPE_MS` (default 5 min) to stop a spamming group from flooding the owner's DM. Suppressed attempts are counted and logged at `warn`. Alerts are best-effort — a failed alert DM is logged, never thrown into the command path.

### 7.3 Command routing

`node-telegram-bot-api` `on('message')`. Parse the command token and args, dispatch to a handler map. For each command, send `Request processing...` first, then edit that message with the command result. If Telegram cannot send or edit the processing message, log the failure and send the final result as a new message. Unknown commands reply with a help block. Non-command messages are ignored in groups (avoids noise); the owner gets a help hint in their DM.

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

**Expiry rule:** there is no client-side or server-side timeout. An order stays `pending` until SimplyPay itself reports it as expired. No cron job, no TTL index, no `expiresAt` field, and no admin-side auto-cancel. This means a SimplyPay order that is never paid and never expired will keep sitting in the `pending` count on `/daily` — that is the intended behaviour, and it is why the `Pending` figure is reported as a raw count rather than treated as a problem. Admin can still force-close one via `POST /api/bot/orders/:orderId/reject`.

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
Order completed 💕

Order type: Payment Order
Order No: B20260928093925967924200
Status: Completed✅
Amount: 400.00
```

Failures keep the plainer slip: `Deposit failed`, then `Order ID`, `Amount`, `Reason` — no emoji, no header icons. `Credited` is dropped because it always equals `Amount`, and `Balance` is dropped because the member reads it back with `/balance`. Amounts on this slip are plain numbers with two decimals (no `₹`).

Sent with `bot.sendMessage(group.groupId, ...)`. Failures are logged, never thrown — the webhook must still return `200`.

Always responds `200 { success: true }`.

## 10. REST API

New router `routes/bot.js` mounted at `/api/bot` in `index.js`. Reuses existing `auth` + `requireAdmin` middleware. Every endpoint keeps the project envelope `{ success, msg }`; failures are `{ success: 'failed', msg }`.

List endpoints use one standard shape, so a panel can share pagination and filter code:

```json
{
  "success": true,
  "msg": "Bot groups fetched",
  "data": [],
  "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 0, "hasNextPage": false, "hasPrevPage": false },
  "filters": { "uid": "32045", "status": "active", "from": "2026-10-01", "to": "2026-10-31" }
}
```

- `data` is an array for lists, an object for single resources.
- `meta` is always present on lists (`total`, `page`, `limit`, `totalPages`, `hasNextPage`, `hasPrevPage`, `nextCursor`). `nextCursor` is `null` on the last page.
- Deep pages can use keyset pagination: pass `?cursor=<meta.nextCursor>` instead of a page number. The cursor is opaque and encodes `createdAt` + `_id`; the server then skips zero documents. `page` reports `1` while a cursor is used. `page`/`limit` continue to work unchanged, so a panel can adopt the cursor without a breaking change. An invalid cursor returns `400 cursor is invalid`.
- `filters` echoes only the filters actually applied.
- `uid` is an **exact 5-digit** match; a value that is not 5 digits returns `400` rather than an empty list. It works on groups, orders and transactions (for orders/transactions it is resolved to the group first).
- A 5-digit `groupId` is treated as a uid fallback, because the `/reg` reply shows the uid next to the id. A full Telegram id resolves to the group too; any other value stays a partial match. When a group resolves, the query is scoped to `$or: [{ group: _id }, { groupId: '<telegram id>' }]` so rows written before the `group` reference still appear.
- `groupId`, `title`, `orderId`, `trnId` are **partial, case-insensitive** matches. `from`/`to` are inclusive; a date-only `to=2026-10-31` covers the whole day. Invalid dates or unknown enum values return `400`.
- Any `:groupId` path segment accepts either the Telegram group id (`-1001234567890`) or the 5-digit `uid` (`32045`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bot/groups` | List groups — `?groupId&uid&title&status=active\|banned\|suspended&from&to&page&limit&cursor` |
| `GET` | `/api/bot/groups/:groupId` | Group detail + balance + last 10 orders + `statusHistory` |
| `PATCH` | `/api/bot/groups/:groupId/status` | `{ status: 'active' \| 'banned' \| 'suspended', remark }` — **remark required** |
| `POST` | `/api/bot/groups/:groupId/ban` | `{ remark }` → `status: 'banned'` |
| `POST` | `/api/bot/groups/:groupId/suspend` | `{ remark }` → `status: 'suspended'` |
| `POST` | `/api/bot/groups/:groupId/unban` | `{ remark }` → `status: 'active'` |
| `POST` | `/api/bot/groups/:groupId/adjust` | `{ amount, type: 'credit'\|'debit', remark }` → creates a `BotOrder` (`orderId` = `B…`, `network: 'MANUAL'`, `direction` = `type`, `status: 'success'`) **and** the linked `note: 'adjustment'` BotTransaction in one transaction, then posts the deposit-style success slip in the group. Response carries `orderId` and `trnId`. Guards against negative resulting balance. |
| `GET` | `/api/bot/orders` | List orders — `?orderId&groupId&uid&status&from&to&page&limit&cursor` |
| `GET` | `/api/bot/orders/:orderId` | Order detail + its BotTransaction if credited |
| `POST` | `/api/bot/orders/:orderId/approve` | Manually credit a stuck `pending` order (same atomic claim + credit path as the webhook) |
| `POST` | `/api/bot/orders/:orderId/reject` | Mark `pending` → `failed` |
| `GET` | `/api/bot/transactions` | List ledger rows — `?trnId&orderId&groupId&uid&type&note&status&from&to&page&limit&cursor`. An unknown `uid` returns `404 Group not found for uid: <uid>`. A 5-digit `groupId` is accepted as a uid. |
| `GET` | `/api/bot/transactions/:trnId` | One ledger row |
| `GET` | `/api/bot/stats/:groupId` | `?window=today\|all` → same shape as `/daily` |
| `GET` | `/api/bot/health` | Bot connected?, transport mode, registered group count (no auth — mirrors existing `/` health check) |

Every status change (ban, suspend, unban) **requires a non-empty `remark`**; the API returns `400` without one. The change updates `status`, `statusRemark`, `statusUpdatedAt`, `statusUpdatedBy` and appends to `statusHistory`.

All admin routes: `auth, requireAdmin`. Errors follow the existing pattern: `throw new Error(msg); err.status = 400;` in services, mapped in controllers.

### 10.1 Query behaviour and cost

- A page of groups is decorated with **one** aggregation for balances (latest `success` row per group), never one query per group. The group list also omits `statusHistory` (it is unbounded; the detail endpoint returns it).
- Every list issues `find` and `countDocuments` in parallel on the same filter, and both use `lean({ getters: true })`.
- Lists sort by `{ createdAt: -1, _id: -1 }`, so `?cursor=` keyset paging is stable even when several rows share a timestamp.
- A resolved group filter is `$or: [{ group: _id }, { groupId: '<telegram id>' }]` (two indexed equality arms) rather than an unanchored case-insensitive regex, which Mongo cannot serve from an index.
- Free-text filters (`groupId` partial, `title`, `orderId`, `trnId`) are intentionally regex and therefore collection scans bounded by the other indexed predicates. The uid path is exact because it is indexed and unique.
- Compound indexes follow ESR (equality → sort → range), e.g. `{ status: 1, createdAt: -1 }`, `{ groupId: 1, createdAt: -1 }`.

## 11. Architecture

```
models/TelegramGroup.js
models/BotOrder.js
models/BotTransaction.js

services/bot/config.js          env parsing + legacy allowlist compatibility + validation
services/bot/client.js          node-telegram-bot-api instance, start/stop
services/bot/guard.js           resolveAuthority() + alertOwner()
services/bot/query.js           admin list filters, date range, pagination meta
services/bot/uid.js             5-digit group uid validation + generation
services/bot/commands.js        message dispatcher
services/bot/upilink.js         parseUpiLink()
services/bot/handlers/reg.js
services/bot/handlers/balance.js
services/bot/handlers/deposit.js
services/bot/handlers/ospayDeposit.js
services/bot/handlers/status.js
services/bot/handlers/daily.js
services/bot/stats.js           getGroupStats() aggregation

services/botGroupService.js     getGroupBalance, getGroupBalances, creditGroup, adjustGroup,
                               registerGroup, listGroups, listTransactions, setGroupStatus,
                               resolveGroup, findGroupForFilter, backfillGroupUids
                               (mirrors services/payinService.js placement)

services/ospay.js               OSPAY signature + create/query/balance calls

controllers/botController.js         REST API
controllers/botWebhookController.js  POST /webhook/simplypay/bot, OSPAY settlement
controllers/ospayController.js       POST /webhook/ospay/bot
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
- Every moderation change (ban, suspend, unban) requires a non-empty `remark` and records `statusUpdatedBy` + a `statusHistory` entry, so who blocked a group and why is always auditable.
- List filters build Mongo queries from a whitelist (`services/bot/query.js`): free text is regex-escaped and matched with `$options: 'i'`, enum values are validated against a fixed list, and date bounds are parsed and range-checked before they reach the query. Raw query objects are never passed through.

## 14. Testing

Vitest, matching the existing pure-unit convention (`tests/*.test.js`, ESM `import` syntax, no DB):

- `tests/upilink.test.js` — full UPI URI, missing `am`, missing `pa`, malformed VPA, non-`upi` scheme, empty string
- `tests/botAmount.test.js` — below min, above max, exact bounds, `NaN`, zero, negative, `"400.50"` string, `"1,000"` rejection
- `tests/botGuard.test.js` — group chats proceed regardless of the legacy allowlist, owner in DM/group, private DM from stranger, malformed legacy allowlist env, and the exact banned/suspended denial messages
- `tests/botCommands.test.js` — registration required for group commands; active groups are allowed and banned, suspended, or invalid statuses are denied
- `tests/botReply.test.js` — command processing message is edited with the final reply; sending/editing failures fall back to a normal reply
- `tests/botQuery.test.js` — group/order/transaction filters, regex escaping, enum validation, inclusive date range (`to` date-only covers the whole day), reversed-range rejection, pagination `meta`, filter echo, keyset cursor round-trip/malformed input/AND-composition
- `tests/botUid.test.js` — 5-digit uid validation, generation bounds, exact group filter, malformed uid → `400`, and `uid` staying out of the transaction Mongo filter (resolved in the controller)
- `tests/botMenu.test.js` — `/` command menu scopes and group help omitting `/reg`
- `tests/botInfo.test.js` — owner info message parsing, active-group broadcast results, per-group delivery failures, and empty/overlong message validation
- `tests/botStatus.test.js` — `/status` slip for pending/success/failed, `Success on` only for success, `paidAt` → `updatedAt` fallback, missing order
- `tests/botStats.test.js` — `startOfIstDay` across UTC/IST midnight boundaries, leap/month/year boundaries, all-time bucket
- `tests/botFormat.test.js` — `Intl.NumberFormat('en-IN')` currency output, stats block rendering

Integration tests against a real DB are out of scope for `npm test` (would need `mongodb-memory-server`, a new dev dependency), so the two highest-risk surfaces are covered separately:

- `tests/requireAll.cjs` — runs under plain `node` before vitest (`npm test:modules`). Vitest resolves imports with Vite, which is more forgiving than Node; a wrong relative path in a handler passed the whole vitest suite and then crashed at runtime with `Cannot find module`. This catches that class of bug.
- `tests/settlement.integration.cjs` — hits the real database and asserts the money path: single settlement credits face value; a replayed callback does not double-credit; **two concurrent settlements for one group both land** (no lost update); a simulated crash mid-transaction leaves the order `pending` with no ledger row; and a retry after that crash succeeds. Run with `node tests/settlement.integration.cjs`. It requires a replica set, since settlement uses multi-document transactions.

The webhook signature path is still only manually verified — recommend a real SimplyPay sandbox order before production.

## 15. Acceptance Criteria

1. Boot with `BOT_ENABLED=true` and a valid token → `bot connected` logged; `/api/bot/health` reports connected.
2. A group runs `/reg` → reply contains the group id, title, `₹0.00` balance, and the command list; a `TelegramGroup` row exists with `status: 'active'`.
3. Only the configured owner can run `/reg` in a group; a non-owner is denied. Owner `/reg` again on the same active group returns the same payload plus `alreadyRegistered: true`; no duplicate row.
4. The owner can run `/reg` regardless of `TELEGRAM_ALLOWED_GROUP_IDS`; that legacy setting does not restrict registration or group commands.
5. A stranger DMs `/balance` → denied, owner alerted with their user id.
6. Registered group runs `/balance` → returns the group's ledger balance.
7. `/d 400` → order row `pending`; reply shows the UPI id, the amount, and a working **Pay now** button pointing at the gateway deep link (or payment link when no `upi://` link is returned).
8. `/d 50` (below min) and `/d 99999999` (above max) → rejected with the configured bound; **no** order row and **no** gateway call.
9. SimplyPay success webhook for that order → `BotOrder.status = 'success'`, one `BotTransaction` with correct `balanceAfter`, group totals incremented, and a success message posted in the group.
10. The same webhook replayed → no second `BotTransaction`, no balance change.
11. Gateway failure webhook → order `failed`, failure message in the group, balance unchanged.
12. No cron, no TTL, no `expiresAt` on `BotOrder` — an abandoned order stays `pending` indefinitely until SimplyPay reports it expired. Verified by waiting 24h+ on a test order and confirming the status is still `pending` and still counted in `/daily`.
13. `/daily` → four success-rate lines (10 min / 30 min / 1 hour / today IST), each `succeeded/total=rate% ₹successful amount`, scoped to the invoking group. Group A's `/daily` must not reflect any order from group B.
14. A `₹400` deposit credits exactly `₹400` even when an active `BonusConfig` would grant a bonus — no bonus leg in the ledger, and no `Commission` record is created for the group.
15. `GET /api/bot/stats/:groupId?window=all` without a JWT → 401; with an admin JWT → 200 matching the Telegram numbers.
16. `POST /api/bot/groups/:groupId/adjust` with a debit exceeding balance → 400, no order row, no ledger row, balance unchanged, no group message.
17. Alert de-dupe → repeated unauthorized private-DM attempts from the same user within 5 minutes produce exactly 1 owner DM.
18. Identity is group-only: after `/reg`, mutating `registeredBy` to a different Telegram user id changes no balance, no order, no stat, and no permission. `grep` the bot source for `userid` and confirm it appears only in comments and in the unrelated admin-JWT path.
19. `/status <order id>` → reply shows order id, amount, status and created time; a credited order also shows `Success on`; an unknown id, or an id belonging to another group, replies `Order not found in this group.`
20. `GET /api/bot/groups?groupId=-100&from=2026-10-01&to=2026-10-31` → only matching groups, `meta` with `total/page/limit/totalPages/hasNextPage/hasPrevPage`, and `filters` echoing the applied subset. An invalid date or unknown `status` → 400.
21. `POST /api/bot/groups/:groupId/ban` (or `/suspend`, `/unban`) without `remark` → 400 and no change; with a remark → `status` updated, `statusRemark`/`statusUpdatedAt`/`statusUpdatedBy` set, a `statusHistory` entry appended, and the group's very next bot message is the support-contact denial.
22. `GET /api/bot/transactions?orderId=…&groupId=…&from=…&to=…` → only matching ledger rows, same `{ success, msg, data, meta, filters }` envelope as `/groups`; `/transactions/:trnId` returns one row or 404.
23. A group runs `/reg` → the reply includes a `UID:` line with a 5-digit code; the same code is returned by `GET /api/bot/groups` and on a second `/reg`.
24. `GET /api/bot/groups?uid=32045` returns exactly that group; `GET /api/bot/groups/32045` and `GET /api/bot/stats/32045` work without the Telegram id; `GET /api/bot/transactions?uid=32045` returns that group's ledger rows (including rows written before uid existed); a uid of `3204` returns `400`; an unknown 5-digit uid on transactions returns `404`.
25. `GET /api/bot/transactions?groupId=32045` (a uid pasted into the group-id box) returns the same rows as `?uid=32045`; `?groupId=-1001234567890` returns every row of that group, including rows that only carry the stored `groupId` string; `GET /api/bot/orders?groupId=32045` behaves the same.
26. A page of 20 groups uses one balance aggregation, not 20 separate balance queries.
27. A list response carries `meta.nextCursor`; passing it back as `?cursor=` returns the next older page with no overlap, works together with `groupId`/`uid` and date filters, and an invalid cursor returns `400 cursor is invalid`.
28. A successful `POST /api/bot/groups/:groupId/adjust` (credit **or** debit) → one `BotOrder` with a fresh `B…` id, `network: 'MANUAL'` and `status: 'success'`; one `BotTransaction` whose `order`/`orderId` point at it and which shares the order's `trnId`; `orderId` in the JSON response; and exactly one group message identical to a deposit success slip (`Order completed 💕` / `Order type: Payment Order` / `Order No: …` / `Status: Completed✅` / `Amount: …`). A **credit** adjustment counts in `/daily` and in the `/balance` `Deposit` line like any other order; a **debit** adjustment carries `direction: 'debit'` and is excluded from both, so money leaving the group never reads as a deposit. Every adjustment answers `/status <order id>`.

## 16. Open Questions

Resolved during drafting (recorded for traceability):

- ~~**Bonus on bot deposits**~~ → **No bonus.** Group deposits credit face value. `BonusConfig` and `calculateBonus` are not used on the bot path; `bonusAmount` has been dropped from `BotOrder`.
- ~~**`/daily` scope**~~ → **That group's daily stats**, today (IST) as the headline plus all-time for context, visible to every member of the registered group.
- ~~**Commission on group deposits**~~ → **None.** `creditCommission` is never called from the bot path; groups have no upline.
- ~~**Deposit expiry**~~ → **Gateway-driven only.** An order expires exclusively when SimplyPay reports it expired. No cron, no TTL, no `expiresAt`. Stale `pending` orders persist and remain visible in the `/daily` pending count. `expired` added to the `BotOrder` status enum.
- ~~**Multi-group isolation**~~ → **Per group, by design.** The `groupId` is the member identifier (§1.1). A human in three groups holds three independent wallets; balances never follow a person between groups. `registeredBy` / `requestedBy` are audit-only and are never used for wallet lookup or authorization.

Still open:

1. **Admin route auth** — assumed the existing admin JWT/role. If support staff need it, they'd need `role: 'admin'` on a web `User`, which conflicts with the bot being independent of that system. Consider a separate `BOT_API_KEY` header instead.
2. **SimplyPay expired status code** — the local apidoc lists `-4` as PENDING, not expired. Confirm the real code before implementation; if none exists, `expired` collapses into `failed`.
