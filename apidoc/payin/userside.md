# Payin & Wallet - User Side API Documentation

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

## Authentication
All payin/wallet endpoints require `Authorization: Bearer <jwt>` header (login via `POST /api/user/login`).
If missing/invalid → `401 { "success": "failed", "msg": "Unauthorized: ..." }`
If user `status !== active` → `403 { "success": "failed", "msg": "Access denied: User is ..." }` (`middleware/auth.js:22`)

---

## Deposit Methods Overview

| Method | Endpoint | Currency | Network | Approval | Bonus |
|--------|----------|----------|---------|----------|-------|
| USDT TRC20 | `POST /api/user/payin` | USDT | TRC20 | Admin manual | No |
| USDT BEP20 | `POST /api/user/payin` | USDT | BEP20 | Admin manual | No |
| INR SimplyPay | `POST /api/user/simplypay/deposit` | INR | SPAY | Auto (webhook) | Yes |

---

## 1. USDT Crypto Deposit (TRC20 / BEP20)

### Create Payin

#### Endpoint: `POST /api/user/payin`
- **Description:** Create a USDT payin for TRC20 or BEP20. Does **NOT** credit balance instantly — creates `Payin` with `status=pending`. Balance is credited only after admin approval.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```

#### Request Body (TRC20):
```json
{
  "amount": 100,
  "network": "TRC20",
  "currency": "USDT"
}
```

#### Request Body (BEP20):
```json
{
  "amount": 120,
  "network": "BEP20",
  "currency": "USDT"
}
```

#### Aliases Accepted:
```json
{ "amt": 100, "net": "TRC20", "currency": "USDT" }
```
- `amt` for `amount`
- `net` for `network`

#### Validation:
- `amount` / `amt` required, must be number `>0`
- `network` / `net` required, must be `TRC20` or `BEP20` (case-insensitive, stored uppercase)
- `currency` **required**, must be `USDT`

#### Response Success (201):
```json
{
  "success": true,
  "payinId": "P20260908100400912345678",
  "address": "0x4993D6bD7E9b27D5B306F36ec0b4Cea8927BB2fB",
  "currency": "USDT",
  "amount": 120,
  "network": "BEP20",
  "exchangeRate": 112,
  "receivedAmount": 13440
}
```
Note: `receivedAmount = amount * exchangeRate` (e.g. 120 USDT * 112 = 13440 INR).

#### Errors:
- 400: `{ "success": "failed", "msg": "amount, network, and currency are required" }`
- 400: `{ "success": "failed", "msg": "currency must be USDT" }`
- 400: `{ "success": "failed", "msg": "Invalid amount" }`
- 400: `{ "success": "failed", "msg": "network must be TRC20 or BEP20" }`
- 400: `{ "success": "failed", "msg": "Deposit address not configured for TRC20" }`
- 401: `{ "success": "failed", "msg": "Unauthorized: No token provided" }`
- 409: `{ "success": "failed", "msg": "Duplicate payin, please retry" }`
- 500: `{ "success": "failed", "msg": "Failed to create payin" }`

---

### Submit Transaction Hash (USDT only)

#### Endpoint: `POST /api/user/payin/submit-tx`
- **Description:** After paying USDT on Binance/crypto wallet, user submits the `txHash` to cross-check against the payin. Can only be submitted **once** per payin (if already set → 409). Payin must be `status=pending`.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```

#### Request Body:
```json
{
  "payinId": "P20260908100400912345678",
  "txHash": "0xabc123def4567890123456789abcdef0123456789abcdef0123456789abcdef"
}
```

#### Validation:
- `payinId` required
- `txHash` required — accepts any string (no format validation)
- Payin must belong to the user and exist
- Payin `status` must be `pending`
- `txHash` must not already be set (submit once only)

#### Response Success (200):
```json
{
  "success": true,
  "msg": "Transaction hash submitted",
  "payin": {
    "payinId": "P20260908100400912345678",
    "txHash": "0xabc123...",
    "network": "BEP20",
    "status": "pending",
    "txSubmittedAt": "2026-09-05T10:10:00.000Z"
  }
}
```

#### Errors:
- 400: `{ "success": "failed", "msg": "payinId and txHash are required" }`
- 400: `{ "success": "failed", "msg": "Cannot submit txHash for payin with status success" }`
- 404: `{ "success": "failed", "msg": "Payin not found" }`
- 409: `{ "success": "failed", "msg": "Transaction hash already submitted", "txHash": "0x..." }`
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to submit transaction hash" }`

---

## 2. INR SimplyPay Deposit

### Create INR Deposit

#### Endpoint: `POST /api/user/simplypay/deposit`
- **Description:** Create an INR deposit via SimplyPay gateway. Returns a payment link for the user to complete payment. Balance is credited automatically on webhook callback (no admin approval needed). Bonus is applied automatically based on admin config.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```

#### Request Body:
```json
{
  "amount": 100,
  "currency": "INR",
  "network": "SPAY"
}
```
- Only `amount` is required
- `currency` and `network` are accepted but ignored (always INR/SPAY)
- `name`, `email`, `mobile` are auto-pulled from the logged-in user's record

#### Validation:
- `amount` required, must be number `>0`

#### Response Success (201):
```json
{
  "success": true,
  "payinId": "FP20260908100400912345678",
  "amount": 100,
  "bonus": 11.2,
  "receivedAmount": 111.2,
  "currency": "INR",
  "paymentLink": "https://...",
  "deepLink": "upi://...",
  "orderNo": "20250905123456789"
}
```
- `bonus` = calculated bonus (percentage + flat, from admin config)
- `receivedAmount` = `amount + bonus`

#### Flow:
1. User calls this endpoint → gets `paymentLink` + `bonus` + `receivedAmount`
2. User opens `paymentLink` → completes payment
3. SimplyPay calls `POST /webhook/simplypay/payin` → auto-credits balance with bonus

#### Errors:
- 400: `{ "success": "failed", "msg": "amount is required" }`
- 400: `{ "success": "failed", "msg": "Invalid amount" }`
- 400: `{ "success": "failed", "msg": "SimplyPay order failed" }`
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to create payin" }`

---

## 3. Get Bonus Config

#### Endpoint: `GET /api/user/bonus-config`
- **Description:** View current INR bonus rates (public — works with or without token).
- **Headers:** `Authorization: Bearer <token>` (optional)

#### Response Success (200):
```json
{
  "success": true,
  "config": {
    "bonusPercentage": 5.2,
    "bonusFlat": 6,
    "isActive": true,
    "updatedAt": "2026-09-05T10:00:00.000Z"
  }
}
```
- `bonusPercentage`: percentage bonus (e.g. 5.2 means 5.2%)
- `bonusFlat`: flat bonus in INR (e.g. 6 RS)
- `isActive`: whether bonus is currently enabled
- Total bonus = `(amount × bonusPercentage / 100) + bonusFlat`

---

## 4. List Payins (All Methods)

#### Endpoint: `GET /api/user/payins?page=1&limit=20&status=pending&network=BEP20`
- **Description:** Get payins for logged-in user with pagination, newest first. Shows both USDT and INR payins.
- **Headers:** `Authorization: Bearer <token>`
- **Query Params:**
  - `page` (default 1)
  - `limit` (default 20, max 100)
  - `status` — `pending` | `success` | `failed` | `reversed` (optional)
  - `network` — `TRC20` | `BEP20` | `SPAY` (optional)

#### Response Success (200):
```json
{
  "success": true,
  "count": 50,
  "page": 1,
  "limit": 20,
  "totalPages": 3,
  "payins": [
    {
      "payinId": "FP20260908100400912345678",
      "currency": "INR",
      "amount": 100,
      "bonusAmount": 11.2,
      "receivedAmount": 111.2,
      "status": "success",
      "transactionType": "payin",
      "remark": "INR deposit via SimplyPay",
      "createdAt": "...",
      "updatedAt": "..."
    },
    {
      "payinId": "P20260908100400912345678",
      "currency": "USDT",
      "amount": 120,
      "bonusAmount": 0,
      "receivedAmount": 13440,
      "status": "pending",
      "transactionType": "payin",
      "remark": "USDT BEP20 deposit",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

#### Errors:
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to fetch payins" }`

---

## 5. List Transactions

#### Endpoint: `GET /api/user/transactions?page=1&limit=20&status=success&type=credit`
- **Description:** Ledger history for logged-in user with pagination, newest first. Every transaction contains `balanceAfter` (wallet after that row). Shows all methods (USDT + INR).
- **Headers:** `Authorization: Bearer <token>`
- **Query Params:**
  - `page` (default 1)
  - `limit` (default 20, max 100)
  - `status` — `pending` | `success` | `failed` | `reversed` (optional)
  - `type` — `credit` | `debit` (optional)
  - `note` — `payin` | `payout` | `reversal` (optional)
  - `network` — `TRC20` | `BEP20` | `INR` (optional)

#### Response Success (200):
```json
{
  "success": true,
  "msg": "Transactions fetched",
  "count": 50,
  "page": 1,
  "limit": 20,
  "totalPages": 3,
  "transactions": [
    {
      "trnId": "TXN20260908100400912345678",
      "currency": "INR",
      "amount": 111.2,
      "type": "credit",
      "note": "payin",
      "remark": "INR deposit via SimplyPay + 11.2 bonus",
      "balanceAfter": 111.2,
      "status": "success",
      "exchangeRate": 1,
      "creditedAmount": 111.2,
      "createdAt": "2026-09-05T10:05:00.000Z",
      "updatedAt": "2026-09-05T10:05:00.000Z"
    },
    {
      "trnId": "TXN20260908100400912345678",
      "currency": "USDT",
      "amount": 120,
      "type": "credit",
      "note": "payin",
      "remark": "BEP20 deposit",
      "balanceAfter": 13540,
      "status": "success",
      "exchangeRate": 112,
      "creditedAmount": 13440,
      "createdAt": "2026-09-05T10:00:00.000Z",
      "updatedAt": "2026-09-05T10:00:00.000Z"
    }
  ]
}
```

#### Transaction Shape:
| Field | Type | Description |
|-------|------|-------------|
| `trnId` | String | Unique, time-based `TXNYYYYMMDDHHMMSS########` (23 digits + prefix), indexed |
| `amount` | Number (Decimal128) | Credited amount (includes bonus for INR) |
| `creditedAmount` | Number (Decimal128) | `amount * exchangeRate` |
| `exchangeRate` | Number (Decimal128) | Rate applied (1 for INR, 112 for USDT) |
| `type` | String | `credit` \| `debit` |
| `note` | String | `payin` \| `payout` \| `reversal` |
| `remark` | String | e.g. `BEP20 deposit`, `INR deposit via SimplyPay + 11.2 bonus` |
| `balanceAfter` | Number (Decimal128) | Wallet after this transaction |
| `status` | String | `pending` \| `success` \| `failed` \| `reversed` |
| `network` | String | `TRC20` \| `BEP20` \| `INR` |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

#### Errors:
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to fetch transactions" }`

---

## 6. Get Balance

#### Endpoint: `GET /api/user/balance`
- **Description:** Current wallet balance = `balanceAfter` of last `status=success` transaction, else `0`. Pending payins do not count. Works for both USDT and INR deposits.
- **Headers:** `Authorization: Bearer <token>`

#### Response Success (200):
```json
{
  "success": true,
  "balance": 9000
}
```

#### Errors:
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to fetch balance" }`

---

## 7. Get Exchange Rate

#### Endpoint: `GET /api/user/payin/exchange`
- **Description:** Fetch current exchange rate. Single rate, no currency/network params. Used for USDT deposits.
- **Headers:** `Authorization: Bearer <token>` (optional — works without token too)

#### Response:
```json
{ "success": true, "rate": 112 }
```

---

## Deposit Flow Comparison

### USDT (Crypto) — Requires Admin Approval
```
1. POST /api/user/payin → Payin pending (no Transaction)
2. User sends USDT to address
3. User submits txHash → POST /api/user/payin/submit-tx
4. Admin approves → POST /api/admin/payins/:payinId/approve
   → Creates Transaction (credit, success, balanceAfter = old + amount × rate)
5. GET /api/user/balance → reflects credited amount
```

### INR (SimplyPay) — Auto-Credited with Bonus
```
1. POST /api/user/simplypay/deposit → Payin pending + returns paymentLink + bonus + receivedAmount
2. User opens paymentLink → completes payment
3. SimplyPay webhook → POST /webhook/simplypay/payin
   → Auto-creates Transaction (credit, success, balanceAfter = old + amount + bonus)
4. GET /api/user/balance → reflects credited amount (no admin needed)
```

---

## Models

### Payin Model Fields
| Field | Type | Description |
|-------|------|-------------|
| `payinId` | String | Unique, time-based `PYYYYMMDDHHMMSS########` — 23 digits after `P` (USDT & INR) |
| `user` | ObjectId | Ref User `_id`, indexed |
| `userid` | Number | Denormalized `User.userid`, indexed |
| `currency` | String | `USDT` or `INR` |
| `network` | String | `TRC20` \| `BEP20` \| `INR` \| `SPAY` |
| `amount` | Decimal128 | Requested amount |
| `address` | String | Deposit address (USDT only, null for INR) |
| `status` | String | `pending` \| `success` \| `failed` \| `reversed` |
| `transactionType` | String | `payin` |
| `txHash` | String | Blockchain hash (USDT only, any string accepted) |
| `confirmations` / `requiredConfirmations` | Number | TRC20: 20, BEP20: 15, INR: 0 |
| `remark` | String | Description |
| `exchangeRate` | Decimal128 | Rate at creation (1 for INR, 112 for USDT) |
| `creditedAmount` | Decimal128 | `amount * exchangeRate` |
| `bonusAmount` | Decimal128 | Bonus applied (INR only, 0 for USDT) |
| `receivedAmount` | Decimal128 | `amount + bonusAmount` (INR) or `amount * exchangeRate` (USDT) |
| `createdAt` / `updatedAt` | Date | Auto |

### Transaction Model Fields
| Field | Type | Description |
|-------|------|-------------|
| `trnId` | String | Unique, time-based `TXNYYYYMMDDHHMMSS########` (23 digits + prefix), indexed |
| `userid` | Number | Denormalized `User.userid`, indexed |
| `amount` | Decimal128 | Amount (includes bonus for INR) |
| `type` | String | `credit` \| `debit` |
| `note` | String | `payin` \| `payout` \| `reversal` |
| `remark` | String | Description |
| `balanceAfter` | Decimal128 | Snapshot of wallet after this row |
| `status` | String | `pending` \| `success` \| `failed` \| `reversed` |
| `referenceId` | String | `Payin.payinId` or `Payout.payoutId` |
| `network` | String | `TRC20` \| `BEP20` \| `INR` |
| `currency` | String | `USDT` or `INR` |
| `exchangeRate` | Decimal128 | Rate applied |
| `creditedAmount` | Decimal128 | `amount * exchangeRate` |
| `txHash` | String | Blockchain hash (USDT only) |
| `createdAt` / `updatedAt` | Date | Auto |

---

## Payout (User)

### Get Payout Switch Status

#### Endpoint: `GET /api/user/payout-switch`
- **Description:** Get current payout switch status for the logged-in user.
- **Headers:** `Authorization: Bearer <token>`

#### Response (200):
```json
{
  "success": true,
  "withdrawal": true
}
```

---

### Toggle Payout Switch

#### Endpoint: `PATCH /api/user/payout-switch`
- **Description:** Enable or disable payout for the logged-in user. When enabling, user must have at least one active bank account.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```

#### Request Body:
```json
{
  "withdrawal": true
}
```

#### Response (200):
```json
{
  "success": true,
  "msg": "Payout enabled",
  "withdrawal": true
}
```

#### Errors:
- 400: `{ "success": "failed", "msg": "withdrawal must be boolean" }`
- 400: `{ "success": "failed", "msg": "Add and enable a bank account first" }`
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to update payout switch" }`
