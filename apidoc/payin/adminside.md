# Payin & Wallet - Admin Side API Documentation

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

## Authentication
All admin payin endpoints require `Authorization: Bearer <admin_jwt>` + `role: admin`. Login via `POST /api/admin/login`.
- 401 `{ "success": "failed", "msg": "Unauthorized: ..." }` if no/invalid token
- 403 `{ "success": "failed", "msg": "Forbidden: Admin access required" }` if not admin (`middleware/requireAdmin.js:2`)

---

## Deposit Address Config (Admin)

Manage USDT deposit addresses per network. When user calls `POST /api/user/payin` the backend uses the active address for that network (`DepositAddress` collection, **no fallback** — if no active address, payin returns `400 {success:'failed',msg:'Deposit address not configured for BEP20'}`). Deleted addresses stay deleted (bug fixed: previously `GET` auto-seeded 2 defaults when count was 0).

### List Deposit Addresses
#### Endpoint: `GET /api/admin/deposit-addresses`
- **Headers:** `Authorization: Bearer <admin_token>`
- **Query Params:**
  - `network`: `TRC20` | `BEP20` (optional)
  - `isActive`: `true` | `false` (optional)
  - `page`: number (default 1)
  - `limit`: number (default 20, max 100)
- **Response (200):**
  ```json
  {
    "success": true,
    "msg": "Deposit addresses fetched",
    "count": 2,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "addresses": [
      { "_id": "...", "currency": "USDT", "network": "TRC20", "address": "TQRcQ...", "label": "USDT TRC20 default", "isActive": true, "createdAt": "..." },
      { "_id": "...", "currency": "USDT", "network": "BEP20", "address": "0x4993...", "label": "USDT BEP20 default", "isActive": true, "createdAt": "..." }
    ]
  }
  ```

### Create Deposit Address
#### Endpoint: `POST /api/admin/deposit-addresses`
- **Headers:** `Authorization: Bearer <admin_token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  { "network": "TRC20", "address": "TXYZ...", "label": "Main TRC20", "isActive": true, "exchangeRate": 90 }
  ```
  `currency` defaults to `USDT` (only USDT allowed). If `isActive:true`, previous active for same `USDT+network` is auto-deactivated (unique active per network). **You can change exchange rate along with address** via `exchangeRate` (or `rate`) — it upserts `ExchangeRate` for that `currency+network` and returns `exchangeRate` in response.
- **Response (201):**
  ```json
  { "success": true, "msg": "Deposit address created", "address": { "_id":"...", "network":"TRC20", "address":"TXYZ...", "isActive": true }, "exchangeRate": { "currency":"USDT", "network":"TRC20", "rate":90 } }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "network and address are required" }`
  - 400: `{ "success": "failed", "msg": "Invalid TRC20 address format" }` / `Invalid BEP20 address format`
  - 422: `{ "success": "failed", "msg": "Address already exists" }`

### Update Deposit Address
#### Endpoint: `PATCH /api/admin/deposit-addresses/:id`
- **Request Body (all optional):** `{ "network": "BEP20", "address": "0x...", "label": "new", "isActive": false, "currency": "USDT", "exchangeRate": 95 }`
- If `exchangeRate` (or `rate`) provided, it also upserts the `ExchangeRate` for that `currency+network`.
- **Response (200):** `{ "success": true, "msg": "Deposit address updated", "address": {...}, "exchangeRate": {...} }`
- **Errors:** 404 not found, 400 invalid format, 422 duplicate

### Toggle Active
#### Endpoint: `PATCH /api/admin/deposit-addresses/:id/toggle`
- **Request Body:** `{ "isActive": true }` or `{ "isActive": false }`
- If activating, other active for same network is auto-deactivated.
- **Response:** `{ "success": true, "msg": "Deposit address activated", "address": {...} }`

### Delete Deposit Address
#### Endpoint: `DELETE /api/admin/deposit-addresses/:id`
- **Response:** `{ "success": true, "msg": "Deposit address deleted" }` — stays deleted (no auto-reseed). If all deleted, `POST /api/user/payin` will fail `400` until admin creates a new one.
- 404 if not found

### Seed Defaults (Explicit)
#### Endpoint: `POST /api/admin/deposit-addresses/seed`
- **Description:** Explicitly seeds the 2 default addresses (`TRC20 TQRc...` / `BEP20 0x4993...`) if they don't already exist. Respects unique active per network (if network already has active, default is created as inactive).
- **Response:** `{ "success": true, "msg": "Default addresses seeded", "created": [...] }` or `"Defaults already exist"`

---

## Payin & Transaction Management (Admin)

### List Payins (Admin)
#### Endpoint: `GET /api/admin/payins`
- **Description:** All payins with pagination. Filter by `userid` (Number), `status` (`pending`|`success`|`failed`|`reversed`), `network`, `payinId`, or `trnId` (resolves via transaction reference).
- **Query Params:** `userid`, `status`, `network`, `payinId`, `trnId`, `page`, `limit`
- **Examples:**
  - `GET /api/admin/payins?userid=3056579&page=1&limit=20`
  - `GET /api/admin/payins?status=pending`
  - `GET /api/admin/payins?trnId=TXN202608240001`
- **Response:**
  ```json
  { "success": true, "msg": "Payins fetched", "count": 50, "page": 1, "limit": 20, "totalPages": 3, "payins": [ { "payinId":"PAY...", "userid":3056579, "amount":120, "network":"BEP20", "address":"0x...", "status":"pending" } ] }
  ```

### List Transactions (Admin)
#### Endpoint: `GET /api/admin/transactions`
- **Description:** Ledger with pagination. Every row has `balanceAfter`. Filter by `userid`, `trnId`, `status`, `type` (`credit`|`debit`), `note` (`payin`|`payout`|`reversal`), `network`.
- **Query Params:** `userid`, `trnId`, `status`, `type`, `note`, `network`, `page`, `limit`
- **Examples:**
  - `GET /api/admin/transactions?userid=3056579&page=1&limit=20`
  - `GET /api/admin/transactions?trnId=TXN202608240001`
  - `GET /api/admin/transactions?status=pending&page=2&limit=50`
- **Response:**
  ```json
  {
    "success": true,
    "msg": "Transactions fetched",
    "count": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5,
    "transactions": [
      { "trnId":"TXN...", "userid":3056579, "amount":120, "type":"credit", "note":"payin", "remark":"BEP20 deposit", "balanceAfter":120, "status":"success", "referenceId":"PAY...", "createdAt":"..." }
    ]
  }
  ```

### Get Transaction by trnId
#### Endpoint: `GET /api/admin/transactions/:trnId`
- **Response:**
  ```json
  { "success": true, "msg": "Transaction fetched", "transaction": { "trnId":"TXN...", "amount":120, "type":"credit", "note":"payin", "remark":"BEP20 deposit", "balanceAfter":0, "status":"pending", "userid":3056579 }, "payin": { "payinId":"PAY...", "status":"pending" } }
  ```
- 404 if not found

### Approve Transaction (Credit)
#### Endpoint: `POST /api/admin/transactions/:trnId/approve`
- **Description:** Approves a `pending` `credit` transaction → `balanceAfter = previousSuccessBalance + (amount * exchangeRate)`. Exchange rate is fetched from `ExchangeRate` (global or per-network) or `exchangeRate` override in body. Updates linked Payin to `success` with `completedAt`, `detectedAmount`, `exchangeRate`, `creditedAmount`.
- **Headers:** `Authorization: Bearer <admin_token>`
- **Request Body (optional):** `{ "txHash": "0x...", "remark": "manual approve", "exchangeRate": 90 }`
- If `exchangeRate` not provided, uses configured rate (`GET /api/admin/exchange-rates/current?currency=USDT&network=BEP20` else global, fallback `1`).
- **Response:**
  ```json
  { "success": true, "msg": "Transaction approved", "transaction": { "trnId":"TXN...", "amount":100, "type":"credit", "note":"payin", "remark":"BEP20 deposit", "balanceAfter":9000, "status":"success", "exchangeRate":90, "creditedAmount":9000 } }
  ```
- **Errors:**
  - 404: `{ "success": "failed", "msg": "Transaction not found" }`
  - 400: `{ "success": "failed", "msg": "Cannot approve, status is success" }` (only pending can be approved)
  - 400: `{ "success": "failed", "msg": "Only credit transactions can be approved as payin" }`

### Reject Transaction
#### Endpoint: `POST /api/admin/transactions/:trnId/reject`
- **Description:** Rejects a `pending` transaction → `status=failed`, `balanceAfter` unchanged, Payin → `failed`.
- **Request Body (optional):** `{ "remark": "invalid proof" }`
- **Response:** `{ "success": true, "msg": "Transaction rejected", "transaction": { "trnId":"TXN...", "status":"failed", "balanceAfter":0 } }`
- Errors same as approve (only pending).

### Reverse Transaction
#### Endpoint: `POST /api/admin/transactions/:trnId/reverse`
- **Description:** Reverses a `success` credit transaction. Creates new `debit` reversal entry (`TXN new`) with `balanceAfter = currentBalance - creditedAmount` (where `creditedAmount = amount * exchangeRate` stored at approve), marks original `status=reversed`, Payin `reversed`.
- **Request Body (optional):** `{ "remark": "user refund" }`
- **Response:**
  ```json
  {
    "success": true,
    "msg": "Transaction reversed",
    "original": { "trnId":"TXN...", "status":"reversed" },
    "reversal": { "trnId":"TXN202608240010", "amount":120, "type":"debit", "note":"reversal", "remark":"Reversal of TXN...", "balanceAfter":0, "status":"success" }
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "Only success transactions can be reversed, current is pending" }`
  - 400: `{ "success": "failed", "msg": "Insufficient balance to reverse" }`

---

## Transaction Shape (shared with user)
| Field | Type | Description |
|-------|------|-------------|
| `trnId` | String | `TXNYYYYMMDD####` |
| `amount` | Decimal128 → number | 120 |
| `type` | `credit` \| `debit` | |
| `note` | `payin` \| `payout` \| `reversal` | |
| `remark` | String | `BEP20 deposit` |
| `balanceAfter` | Decimal128 → number | wallet after row |
| `status` | `pending` \| `success` \| `failed` \| `reversed` | |
| `userid` / `user` | Number / ObjectId | owner |
| `referenceId` | String | `PAY...` |
| `createdAt` / `updatedAt` | Date | |

## Exchange Rate Config (Admin)

Balance increase = `payin amount * exchangeRate`. Rate configurable per `USDT` global or per network (`TRC20`/`BEP20`), fallback `1`.

### List Exchange Rates
#### Endpoint: `GET /api/admin/exchange-rates`
- **Headers:** `Authorization: Bearer <admin_token>`
- **Query:** `currency` (default USDT), `network` (TRC20/BEP20/global), `isActive`, `page`, `limit`
- **Response:** `{ "success": true, "msg": "Exchange rates fetched", "count": 1, "rates": [{ "_id":"...", "currency":"USDT", "network":null, "rate":90, "isActive":true }] }`

### Get Current Rate
#### Endpoint: `GET /api/admin/exchange-rates/current?currency=USDT&network=BEP20`
- Also available to user: `GET /api/user/exchange-rate?currency=USDT&network=BEP20` (auth, same logic)
- **Response:** `{ "success": true, "currency":"USDT", "network":"BEP20", "rate":90 }` — returns active network-specific else global else `1`.

### Create / Upsert Exchange Rate
#### Endpoint: `POST /api/admin/exchange-rates`
- **Body:** `{ "currency":"USDT", "network":"BEP20" | "TRC20" | null, "rate":90, "label":"global 90", "isActive":true }`
- If `isActive:true`, previous active for same `currency+network` auto-deactivated.
- **Response:** `{ "success": true, "msg": "Exchange rate saved", "rate": {...} }`

### Update Exchange Rate
#### Endpoint: `PATCH /api/admin/exchange-rates/:id`
- **Body:** `{ "rate":95, "label":"updated", "isActive":true, "network":"TRC20" }`
- **Response:** `{ "success": true, "msg": "Exchange rate updated", "rate": {...} }`

### Delete Exchange Rate
#### Endpoint: `DELETE /api/admin/exchange-rates/:id`
- **Response:** `{ "success": true, "msg": "Exchange rate deleted" }`

---

## Transaction Shape (with exchange rate)
| Field | Type | Description |
|-------|------|-------------|
| `trnId` | String | `TXNYYYYMMDD####` |
| `amount` | Decimal128 → number | 100 (original USDT) |
| `creditedAmount` | Decimal128 → number | 9000 (`amount * rate`) |
| `exchangeRate` | Decimal128 → number | 90 |
| `type` | `credit` \| `debit` | |
| `note` | `payin` \| `payout` \| `reversal` | |
| `remark` | String | `BEP20 deposit` |
| `balanceAfter` | Decimal128 → number | wallet after row (includes creditedAmount) |
| `status` | `pending` \| `success` \| `failed` \| `reversed` | |
| `userid` / `user` | Number / ObjectId | owner |
| `referenceId` | String | `PAY...` |
| `createdAt` / `updatedAt` | Date | |

## Pagination Convention
All list endpoints return `{ count: totalDocs, page, limit, totalPages, ... }` with `limit max 100`.

---

## Payout Management (Admin)

### List Payout Users

#### Endpoint: `GET /api/admin/payout-users`
- **Description:** List all active users with payout enabled, their active banks, and current balance.
- **Headers:** `Authorization: Bearer <admin_token>`
- **Query Params:** `page` (default 1), `limit` (default 20, max 100)
- **Response (200):**
  ```json
  {
    "success": true,
    "msg": "Payout users fetched",
    "count": 5,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "users": [
      {
        "uid": 3056579,
        "mobile": "9876543210",
        "balance": 13440,
        "payoutEnabled": true,
        "banks": [
          {
            "bankName": "HDFC",
            "holderName": "John",
            "accountNumber": "1234567890",
            "ifsc": "HDFC0001234",
            "status": "enable"
          }
        ]
      }
    ]
  }
  ```

---

### Create Payout Order(s)

#### Endpoint: `POST /api/admin/payout`
- **Description:** Create payout orders for a user. Admin selects a bank, enters amount and number of orders. Amount is deducted from user balance. Each order = same `amount`, total deduction = `amount × numberOfOrders`.
- **Headers:** `Authorization: Bearer <admin_token>`
- **Request Body:**
  ```json
  {
    "userid": 3056579,
    "amount": 100,
    "numberOfOrders": 3,
    "accountNumber": "1234567890"
  }
  ```
- **Response (201):**
  ```json
  {
    "success": true,
    "msg": "3 payout orders created",
    "totalDeduction": 300,
    "payouts": [
      {
        "payoutId": "PAYOUT202608310001",
        "amount": 100,
        "status": "pending",
        "bankName": "HDFC",
        "holderName": "John",
        "accountNumber": "1234567890",
        "ifsc": "HDFC0001234",
        "trnId": "TXN202608310001",
        "createdAt": "..."
      }
    ]
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "userid, amount, numberOfOrders, and accountNumber are required" }`
  - 400: `{ "success": "failed", "msg": "Invalid amount or numberOfOrders" }`
  - 404: `{ "success": "failed", "msg": "User not found or payout not enabled" }`
  - 400: `{ "success": "failed", "msg": "Bank account not found or not active" }`
  - 400: `{ "success": "failed", "msg": "Insufficient balance. Required: 300, Available: 200" }`
  - 500: `{ "success": "failed", "msg": "Failed to create payout orders" }`

---

### List Payouts

#### Endpoint: `GET /api/admin/payouts`
- **Headers:** `Authorization: Bearer <admin_token>`
- **Query Params:** `userid`, `status` (pending|success|failed), `payoutId`, `page`, `limit`
- **Response (200):**
  ```json
  {
    "success": true,
    "msg": "Payouts fetched",
    "count": 10,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "payouts": [
      {
        "payoutId": "PAYOUT202608310001",
        "userid": 3056579,
        "amount": 100,
        "status": "pending",
        "bankName": "HDFC",
        "holderName": "John",
        "accountNumber": "1234567890",
        "ifsc": "HDFC0001234",
        "trnId": "TXN202608310001",
        "remark": "",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
  ```

---

### Approve Payout

#### Endpoint: `POST /api/admin/payouts/:payoutId/approve`
- **Headers:** `Authorization: Bearer <admin_token>`
- **Request Body:**
  ```json
  {
    "remark": "Payment processed via NEFT"
  }
  ```
  `remark` is **required**.
- **Response (200):**
  ```json
  {
    "success": true,
    "msg": "Payout approved",
    "payout": {
      "payoutId": "PAYOUT202608310001",
      "amount": 100,
      "status": "success",
      "remark": "Payment processed via NEFT",
      "completedAt": "..."
    }
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "remark is required" }`
  - 400: `{ "success": "failed", "msg": "Cannot approve, status is success" }`
  - 404: `{ "success": "failed", "msg": "Payout not found" }`

---

### Reject Payout

#### Endpoint: `POST /api/admin/payouts/:payoutId/reject`
- **Description:** Rejects payout and **refunds** the amount back to user's balance.
- **Headers:** `Authorization: Bearer <admin_token>`
- **Request Body:**
  ```json
  {
    "remark": "Bank details mismatch"
  }
  ```
  `remark` is **required**.
- **Response (200):**
  ```json
  {
    "success": true,
    "msg": "Payout rejected",
    "payout": {
      "payoutId": "PAYOUT202608310001",
      "amount": 100,
      "status": "failed",
      "remark": "Bank details mismatch",
      "failedAt": "..."
    }
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "remark is required" }`
  - 400: `{ "success": "failed", "msg": "Cannot reject, status is success" }`
  - 404: `{ "success": "failed", "msg": "Payout not found" }`
