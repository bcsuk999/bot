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

| Method | Endpoint | Currency | Network | Approval |
|--------|----------|----------|---------|----------|
| USDT TRC20 | `POST /api/user/payin` | USDT | TRC20 | Admin manual |
| USDT BEP20 | `POST /api/user/payin` | USDT | BEP20 | Admin manual |
| INR SimplyPay | `POST /api/user/simplypay/deposit` | INR | SPAY | Auto (webhook) |

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
  "payinId": "PAY202609050001",
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
  "payinId": "PAY202609050001",
  "txHash": "0xabc123def4567890123456789abcdef0123456789abcdef0123456789abcdef"
}
```

#### Validation:
- `payinId` required
- `txHash` required, must be `0x` + 64 hex chars (EVM/TRC20/BEP20 format)
- Payin must belong to the user and exist
- Payin `status` must be `pending`
- `txHash` must not already be set (submit once only)

#### Response Success (200):
```json
{
  "success": true,
  "msg": "Transaction hash submitted",
  "payin": {
    "payinId": "PAY202609050001",
    "txHash": "0xabc123...",
    "network": "BEP20",
    "status": "pending",
    "txSubmittedAt": "2026-09-05T10:10:00.000Z"
  }
}
```

#### Errors:
- 400: `{ "success": "failed", "msg": "payinId and txHash are required" }`
- 400: `{ "success": "failed", "msg": "Invalid transaction hash format" }`
- 400: `{ "success": "failed", "msg": "Cannot submit txHash for payin with status success" }`
- 404: `{ "success": "failed", "msg": "Payin not found" }`
- 409: `{ "success": "failed", "msg": "Transaction hash already submitted", "txHash": "0x..." }`
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to submit transaction hash" }`

---

## 2. INR SimplyPay Deposit

### Create INR Deposit

#### Endpoint: `POST /api/user/simplypay/deposit`
- **Description:** Create an INR deposit via SimplyPay gateway. Returns a payment link for the user to complete payment. Balance is credited automatically on webhook callback (no admin approval needed).
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
  "payinId": "FPAY202609050001",
  "amount": 100,
  "currency": "INR",
  "paymentLink": "https://...",
  "deepLink": "upi://...",
  "orderNo": "20250905123456789"
}
```

#### Flow:
1. User calls this endpoint → gets `paymentLink`
2. User opens `paymentLink` → completes payment
3. SimplyPay calls `POST /webhook/simplypay/payin` → auto-credits balance

#### Errors:
- 400: `{ "success": "failed", "msg": "amount is required" }`
- 400: `{ "success": "failed", "msg": "Invalid amount" }`
- 400: `{ "success": "failed", "msg": "SimplyPay order failed" }`
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to create payin" }`

---

## 3. List Payins (All Methods)

#### Endpoint: `GET /api/user/payins?page=1&limit=20&status=pending&network=BEP20`
- **Description:** Get payins for logged-in user with pagination, newest first. Shows both USDT and INR payins.
- **Headers:** `Authorization: Bearer <token>`
- **Query Params:**
  - `page` (default 1)
  - `limit` (default 20, max 100)
  - `status` — `pending` | `success` | `failed` | `reversed` (optional)
  - `network` — `TRC20` | `BEP20` | `INR` | `SPAY` (optional)

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
      "payinId": "FPAY202609050001",
      "currency": "INR",
      "amount": 100,
      "receivedAmount": 100,
      "status": "success",
      "transactionType": "payin",
      "remark": "INR deposit via SimplyPay",
      "createdAt": "...",
      "updatedAt": "..."
    },
    {
      "payinId": "PAY202609050001",
      "currency": "USDT",
      "amount": 120,
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

## 4. List Transactions

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
      "trnId": "TXN202609050002",
      "currency": "INR",
      "amount": 100,
      "type": "credit",
      "note": "payin",
      "remark": "INR deposit via SimplyPay",
      "balanceAfter": 100,
      "status": "success",
      "exchangeRate": 1,
      "creditedAmount": 100,
      "createdAt": "2026-09-05T10:05:00.000Z",
      "updatedAt": "2026-09-05T10:05:00.000Z"
    },
    {
      "trnId": "TXN202609050001",
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
| `trnId` | String | Unique `TXNYYYYMMDD####`, indexed |
| `currency` | String | `USDT` or `INR` |
| `amount` | Number (Decimal128) | Requested amount |
| `creditedAmount` | Number (Decimal128) | `amount * exchangeRate` |
| `exchangeRate` | Number (Decimal128) | Rate applied (1 for INR, 112 for USDT) |
| `type` | String | `credit` \| `debit` |
| `note` | String | `payin` \| `payout` \| `reversal` |
| `remark` | String | e.g. `BEP20 deposit`, `INR deposit via SimplyPay` |
| `balanceAfter` | Number (Decimal128) | Wallet after this transaction |
| `status` | String | `pending` \| `success` \| `failed` \| `reversed` |
| `network` | String | `TRC20` \| `BEP20` \| `INR` |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

#### Errors:
- 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
- 500: `{ "success": "failed", "msg": "Failed to fetch transactions" }`

---

## 5. Get Balance

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

## 6. Get Exchange Rate

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

### INR (SimplyPay) — Auto-Credited
```
1. POST /api/user/simplypay/deposit → Payin pending + returns paymentLink
2. User opens paymentLink → completes payment
3. SimplyPay webhook → POST /webhook/simplypay/payin
   → Auto-creates Transaction (credit, success, balanceAfter = old + amount)
4. GET /api/user/balance → reflects credited amount (no admin needed)
```

---

## Models

### Payin Model Fields
| Field | Type | Description |
|-------|------|-------------|
| `payinId` | String | Unique ID — `PAYYYYYMMDD####` (USDT) or `FPAYYYYYMMDD####` (INR) |
| `user` | ObjectId | Ref User `_id`, indexed |
| `userid` | Number | Denormalized `User.userid`, indexed |
| `currency` | String | `USDT` or `INR` |
| `network` | String | `TRC20` \| `BEP20` \| `INR` \| `SPAY` |
| `amount` | Decimal128 | Requested amount |
| `address` | String | Deposit address (USDT only, null for INR) |
| `status` | String | `pending` \| `success` \| `failed` \| `reversed` |
| `transactionType` | String | `payin` |
| `txHash` | String | Blockchain hash (USDT only) |
| `confirmations` / `requiredConfirmations` | Number | TRC20: 20, BEP20: 15, INR: 0 |
| `remark` | String | Description |
| `exchangeRate` | Decimal128 | Rate at creation (1 for INR, 112 for USDT) |
| `creditedAmount` | Decimal128 | `amount * exchangeRate` |
| `createdAt` / `updatedAt` | Date | Auto |

### Transaction Model Fields
| Field | Type | Description |
|-------|------|-------------|
| `trnId` | String | Unique `TXNYYYYMMDD####`, indexed |
| `user` | ObjectId | Ref User `_id`, indexed |
| `userid` | Number | Denormalized `User.userid`, indexed |
| `amount` | Decimal128 | Amount |
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
