# Bot Admin API — Group Name & Exchange Rate (latest change)

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

All endpoints below are mounted under `/api/bot` and require an **admin JWT**:

```
Authorization: Bearer <admin_jwt>
```

Get the token from `POST /api/admin/login`.

`:groupId` in every route accepts **either** the Telegram group id (e.g. `-1001234567890`) **or** the 5-digit public `uid` (e.g. `32045`).

---

## 1. Edit group name and/or exchange rate (NEW)

### Endpoint
```
PATCH /api/bot/groups/:groupId
```

### Description
Updates a registered group's display name and/or its exchange rate. The rate is
used only by the owner's `/pl` profit/loss report and is stored in **INR per
1 USDT**.

Send either field, or both. Omitted fields are left unchanged.

### Headers
```
Authorization: Bearer <admin_jwt>
Content-Type: application/json
```

### Request body
| Field | Type | Required | Rules |
|---|---|---|---|
| `title` | string | no | Trimmed, non-empty, max 128 characters |
| `exchangeRate` | number \| null | no | Must be `> 0`; send `null` or `""` to clear it |

At least one of `title` / `exchangeRate` must be present.

### Example — set both
```http
PATCH /api/bot/groups/32045
Authorization: Bearer <admin_jwt>
Content-Type: application/json

{
  "title": "Test Group",
  "exchangeRate": 160
}
```

### Example — change only the rate
```json
{ "exchangeRate": 165.5 }
```

### Example — clear the rate
```json
{ "exchangeRate": null }
```

### Success response — `200`
```json
{
  "success": true,
  "msg": "Group updated",
  "data": {
    "groupId": "-1001234567890",
    "uid": "32045",
    "title": "Test Group",
    "username": "testgroup",
    "type": "supergroup",
    "status": "active",
    "statusRemark": "",
    "statusUpdatedAt": null,
    "statusUpdatedBy": null,
    "balance": 12000,
    "totalDeposits": 4,
    "totalCredited": 12000,
    "totalFailed": 0,
    "exchangeRate": 160,
    "registeredBy": 7716906489,
    "createdAt": "2026-11-01T10:00:00.000Z",
    "lastActiveAt": "2026-11-08T09:15:00.000Z"
  }
}
```

### Error responses
| Status | When | Body |
|---|---|---|
| `400` | no fields sent | `{ "success": "failed", "msg": "Provide title and/or exchangeRate" }` |
| `400` | empty title | `{ "success": "failed", "msg": "title cannot be empty" }` |
| `400` | title too long | `{ "success": "failed", "msg": "title must be at most 128 characters" }` |
| `400` | rate `<= 0` / not a number | `{ "success": "failed", "msg": "exchangeRate must be a number greater than 0" }` |
| `404` | group not found | `{ "success": "failed", "msg": "Group not found" }` |
| `401/403` | missing token / not admin | handled by existing auth middleware |

---

## 2. Group responses now include `exchangeRate` (CHANGED)

The new field is returned by the existing admin group endpoints:

### `GET /api/bot/groups`
```json
{
  "success": true,
  "msg": "Bot groups fetched",
  "data": [
    {
      "groupId": "-1001234567890",
      "uid": "32045",
      "title": "Test Group",
      "status": "active",
      "balance": 12000,
      "exchangeRate": 160,
      "...": "other existing fields"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1, "nextCursor": null },
  "filters": {}
}
```

### `GET /api/bot/groups/:groupId`
```json
{
  "success": true,
  "data": {
    "group": { "uid": "32045", "title": "Test Group", "exchangeRate": 160, "...": "..." },
    "statusHistory": [],
    "counts": { "success": 4, "pending": 0, "failed": 0, "expired": 0, "reversed": 0 },
    "recentOrders": []
  }
}
```

`exchangeRate` is `null` when the admin has not set a rate for the group.

---

## 3. Blocked UPIs (NEW)

Admin can block a UPI id. When `/d` creates an order whose gateway-assigned
UPI matches a blocked entry, the bot does **not** show the payment slip and
replies:

```
⚠️ Please create another order with a different amount. Thank you.
```

The order is marked `failed` and the owner is alerted (with a copy button for
the order id). The member is expected to retry `/d` with a different amount,
which routes through a different channel.

### List blocked UPIs

```
GET /api/bot/blocked-upis
```

**Response `200`**
```json
{
  "success": true,
  "msg": "Blocked UPIs fetched",
  "count": 1,
  "data": [
    { "_id": "...", "upiId": "scam@ybl", "reason": "fraud", "createdBy": 123, "createdAt": "..." }
  ]
}
```

### Block a UPI

```
POST /api/bot/blocked-upis
Content-Type: application/json

{ "upiId": "scam@ybl", "reason": "fraud" }
```

- `upiId` is normalized (trimmed + lowercased) and stored unique.
- Re-blocking an existing UPI updates its reason.

**Response `201`**
```json
{ "success": true, "msg": "UPI blocked", "data": { "upiId": "scam@ybl", "reason": "fraud", ... } }
```

### Unblock a UPI

```
DELETE /api/bot/blocked-upis/:upiId
```

**Response `200`** `{ "success": true, "msg": "UPI unblocked" }`
**Response `404`** `{ "success": "failed", "msg": "UPI not found in blocklist" }`

---

## 4. Related owner bot command — `/pl`

Not an HTTP endpoint. Used by the bot owner in the bot's private chat.

```
/pl <t|y|w|m|DD/MM/YY> <cost per USDT>
```

Examples:
```
/pl t 107     (today)
/pl y 107     (yesterday)
/pl w 107     (this week, Mon-Sun IST)
/pl m 107     (this month)
/pl 23/11/26 107
/pl 107       (today, cost-only shortcut)
```

Rules:
- Owner-only; refused in groups and for non-owner DMs.
- Only groups with `status: "active"` **and** an exchange rate set are included.
  Banned/suspended groups and groups with no rate are excluded.
- Date is an IST day; `DD/MM/YY` or `DD/MM/YYYY`.
- Per group (no report header, no group title):
  ```
  UID: 32045 | 160
  Todays deposit: ₹12,000.00
  Total deposit: ₹1,20,000.00
  Total payout: ₹40,000.00
  Todays payout: ₹2,000.00
  Profit/Loss: 🟢₹3,303.00
  ```
- 🟢 = profit/break-even, 🔴 = loss.
- Payout = admin manual debit adjustments (`BotOrder.direction = "debit"`).
- Totals are lifetime; "Todays" is the selected IST day.
- Formula:
  ```
  (((exchangeRate - cost) / exchangeRate) - 0.056) × todays deposit
  ```
- The report ends with an `All groups total` block covering the same rated groups.
- If no active group has a rate set, the report replies
  `No active groups with an exchange rate set.`
- Long reports are split across multiple Telegram messages.

---

## 4. Quick endpoint table (`/api/bot`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Bot health (no auth) |
| `GET` | `/groups` | List groups (now returns `exchangeRate`) |
| `GET` | `/groups/:groupId` | Group detail (now returns `exchangeRate`) |
| `PATCH` | `/groups/:groupId` | **NEW** edit `title` / `exchangeRate` |
| `PATCH` | `/groups/:groupId/status` | Change status (`active`/`banned`/`suspended`) |
| `POST` | `/groups/:groupId/ban` | Ban group |
| `POST` | `/groups/:groupId/suspend` | Suspend group |
| `POST` | `/groups/:groupId/unban` | Unban group |
| `POST` | `/groups/:groupId/adjust` | Manual credit/debit |
| `GET` | `/blocked-upis` | List blocked UPIs |
| `POST` | `/blocked-upis` | Block a UPI |
| `DELETE` | `/blocked-upis/:upiId` | Unblock a UPI |
| `GET` | `/orders` | List orders |
| `GET` | `/orders/:orderId` | Order detail |
| `POST` | `/orders/:orderId/approve` | Approve order |
| `POST` | `/orders/:orderId/reject` | Reject order |
| `GET` | `/transactions` | List ledger rows |
| `GET` | `/transactions/:trnId` | Ledger row detail |
| `GET` | `/stats/:groupId` | Deposit stats |
