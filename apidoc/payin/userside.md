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

### Create Payin (Deposit)

#### Endpoint: `POST /api/user/payin`
- **Description:** Create a USDT payin for TRC20 or BEP20. Does **NOT** credit balance instantly — creates `Payin` with `status=pending`. Balance is credited only after admin approval.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "amount": 120,
    "network": "BEP20",
    "currency": "USDT"
  }
  ```
  Aliases accepted: `amt` for `amount`, `net` for `network`. `currency` is **required** (only `USDT` allowed).
  ```json
  { "amt": 120, "net": "TRC20", "currency": "USDT" }
  ```
- **Validation:**
  - `amount` / `amt` required, must be number `>0`
  - `network` / `net` required, must be `TRC20` or `BEP20` (case-insensitive, stored uppercase)
  - `currency` **required**, must be `USDT`
- **Response Success (201):**
  ```json
  {
    "success": true,
    "payinId": "PAY202608240001",
    "address": "0x4993D6bD7E9b27D5B306F36ec0b4Cea8927BB2fB",
    "currency": "USDT",
    "amount": 120,
    "network": "BEP20",
    "exchangeRate": 112,
    "receivedAmount": 13440
  }
  ```
  Note: `receivedAmount = amount * exchangeRate` (e.g. 120 USDT * 112 = 13440 INR).
- **Errors:**
  - 400: `{ "success": "failed", "msg": "amount, network, and currency are required" }`
  - 400: `{ "success": "failed", "msg": "currency must be USDT" }`
  - 400: `{ "success": "failed", "msg": "Invalid amount" }`
  - 400: `{ "success": "failed", "msg": "network must be TRC20 or BEP20" }`
  - 400: `{ "success": "failed", "msg": "Deposit address not configured for TRC20" }`
  - 401: `{ "success": "failed", "msg": "Unauthorized: No token provided" }`
  - 409: `{ "success": "failed", "msg": "Duplicate payin, please retry" }`
  - 500: `{ "success": "failed", "msg": "Failed to create payin" }`

---

### Create INR Deposit (SimplyPay)

#### Endpoint: `POST /api/user/simplypay/deposit`
- **Description:** Create an INR deposit via SimplyPay gateway. Returns a payment link for the user to complete payment. Balance is credited automatically on webhook callback (no admin approval needed).
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "amount": 500,
    "name": "John",
    "email": "john@example.com",
    "mobile": "9999999999"
  }
  ```
  Only `amount` is required. `name`, `email`, `mobile` are optional.
- **Validation:**
  - `amount` required, must be number `>0`
- **Response Success (201):**
  ```json
  {
    "success": true,
    "payinId": "FPAY202609050001",
    "amount": 500,
    "currency": "INR",
    "paymentLink": "https://...",
    "deepLink": "upi://...",
    "orderNo": "20250905123456789"
  }
  ```
- **Flow:**
  1. User calls this endpoint → gets `paymentLink`
  2. User opens `paymentLink` → completes payment
  3. SimplyPay calls `POST /webhook/simplypay/payin` → auto-credits balance
- **Errors:**
  - 400: `{ "success": "failed", "msg": "amount is required" }`
  - 400: `{ "success": "failed", "msg": "Invalid amount" }`
  - 400: `{ "success": "failed", "msg": "SimplyPay order failed" }`
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to create payin" }`

---

### List Payins

#### Endpoint: `GET /api/user/payins?page=1&limit=20&status=pending&network=BEP20`
- **Description:** Get payins for logged-in user with pagination, newest first.
- **Headers:** `Authorization: Bearer <token>`
- **Query Params:** `page` (default 1), `limit` (default 20, max 100), `status` (`pending|success|failed|reversed` optional), `network` (`TRC20|BEP20` optional)
- **Response Success (200):**
  ```json
  {
    "success": true,
    "count": 50,
    "page": 1,
    "limit": 20,
    "totalPages": 3,
    "payins": [
      {
        "payinId": "PAY202608240001",
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
- **Errors:**
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to fetch payins" }`

---

### Submit Transaction Hash

#### Endpoint: `POST /api/user/payin/submit-tx`
- **Description:** After paying USDT on Binance/crypto wallet, user submits the `txHash` to cross-check against the payin. Can only be submitted **once** per payin (if already set → 409). Payin must be `status=pending`.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "payinId": "PAY202608240001",
    "txHash": "0xabc123...64hexchars"
  }
  ```
- **Validation:**
  - `payinId` required
  - `txHash` required, must be `0x` + 64 hex chars (EVM/TRC20/BEP20 format)
  - Payin must belong to the user and exist
  - Payin `status` must be `pending`
  - `txHash` must not already be set (submit once only)
- **Response Success (200):**
  ```json
  {
    "success": true,
    "msg": "Transaction hash submitted",
    "payin": {
      "payinId": "PAY202608240001",
      "txHash": "0xabc123...",
      "network": "BEP20",
      "status": "pending",
      "txSubmittedAt": "2026-08-24T10:10:00.000Z"
    }
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "payinId and txHash are required" }`
  - 400: `{ "success": "failed", "msg": "Invalid transaction hash format" }`
  - 400: `{ "success": "failed", "msg": "Cannot submit txHash for payin with status success" }`
  - 404: `{ "success": "failed", "msg": "Payin not found" }`
  - 409: `{ "success": "failed", "msg": "Transaction hash already submitted", "txHash": "0x..." }`
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to submit transaction hash" }`

---

### List Transactions

#### Endpoint: `GET /api/user/transactions?page=1&limit=20&status=pending&type=credit&note=payin&network=BEP20`
- **Description:** Ledger history for logged-in user with pagination, newest first. Every transaction contains `balanceAfter` (wallet after that row).
- **Headers:** `Authorization: Bearer <token>`
- **Query Params:** `page` (default 1), `limit` (default 20, max 100), `status` (`pending|success|failed|reversed`), `type` (`credit|debit`), `note` (`payin|payout|reversal`), `network` (`TRC20|BEP20`) all optional
- **Response Success (200):**
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
        "trnId": "TXN202608240002",
        "currency": "USDT",
        "amount": 50,
        "type": "credit",
        "note": "payin",
        "remark": "TRC20 deposit",
        "balanceAfter": 0,
        "status": "pending",
        "createdAt": "2026-08-24T10:05:00.000Z",
        "updatedAt": "2026-08-24T10:05:00.000Z"
      },
      {
        "trnId": "TXN202608240001",
        "currency": "USDT",
        "amount": 120,
        "type": "credit",
        "note": "payin",
        "remark": "BEP20 deposit",
        "balanceAfter": 0,
        "status": "pending",
        "createdAt": "2026-08-24T10:00:00.000Z",
        "updatedAt": "2026-08-24T10:00:00.000Z"
      }
    ]
  }
  ```
- **Transaction shape (as requested):**
  | Field | Type | Description |
  |-------|------|-------------|
  | `trnId` | String | Unique `TXNYYYYMMDD####`, indexed |
  | `currency` | String | `USDT` |
  | `amount` | Number (Decimal128) | Requested USDT amount (e.g. 100) |
  | `creditedAmount` | Number (Decimal128) | `amount * exchangeRate` (e.g. 9000 if rate 90) |
  | `exchangeRate` | Number (Decimal128) | Rate applied at approve (e.g. 90) |
  | `type` | String | `credit` \| `debit` |
  | `note` | String | `payin` \| `payout` \| `reversal` |
  | `remark` | String | e.g. `BEP20 deposit` |
  | `balanceAfter` | Number (Decimal128) | Wallet after this transaction (includes creditedAmount) |
  | `status` | String | `pending` \| `success` \| `failed` \| `reversed` |
  | `createdAt` | Date | Auto |
  | `updatedAt` | Date | Auto |
- **Errors:**
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to fetch transactions" }`

---

### Get Balance

#### Endpoint: `GET /api/user/balance`
- **Description:** Current wallet balance = `balanceAfter` of last `status=success` transaction, else `0`. Pending payins do not count. Balance increase on approve = `payin amount * exchangeRate` (e.g. 100 USDT * 90 = 9000).
- **Headers:** `Authorization: Bearer <token>`
- **Response Success (200):**
  ```json
  {
    "success": true,
    "balance": 9000
  }
  ```
- **Errors:**
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to fetch balance" }`

---

## Models

### Payin Model Fields
| Field | Type | Description |
|-------|------|-------------|
| `payinId` | String | Unique `PAYYYYYMMDD####`, indexed |
| `user` | ObjectId | Ref User `_id`, indexed |
| `userid` | Number | Denormalized `User.userid`, indexed |
| `currency` | String | `USDT` (uppercase enum) |
| `network` | String | `TRC20` \| `BEP20` |
| `amount` | Decimal128 | Requested amount |
| `address` | String | Deposit address for network |
| `status` | String | `pending` \| `success` \| `failed` \| `reversed` (default `pending`) |
| `transactionType` | String | `payin` |
| `txHash` | String | Blockchain hash (set on confirm) |
| `confirmations` / `requiredConfirmations` | Number | e.g. TRC20 20, BEP20 15 |
| `remark` | String | `USDT {network} deposit` |
| `exchangeRate` | Decimal128 | Rate at creation (e.g. 112) |
| `creditedAmount` | Decimal128 | `amount * exchangeRate` (e.g. 13440) |
| `createdAt` / `updatedAt` | Date | Auto |

**Indexes:** `payinId unique`, `user`, `userid`, `status`, `user+status`, `user+createdAt`

### Transaction Model Fields
| Field | Type | Description |
|-------|------|-------------|
| `trnId` | String | Unique `TXNYYYYMMDD####`, indexed |
| `user` | ObjectId | Ref User `_id`, indexed |
| `userid` | Number | Denormalized `User.userid`, indexed |
| `amount` | Decimal128 | Amount |
| `type` | String | `credit` \| `debit` |
| `note` | String | `payin` \| `payout` \| `reversal` |
| `remark` | String | `TRC20 deposit` / `BEP20 deposit` |
| `balanceAfter` | Decimal128 | Snapshot of wallet after this row |
| `status` | String | `pending` \| `success` \| `failed` \| `reversed` |
| `referenceId` | String | `Payin.payinId` link, indexed |
| `network` | String | `TRC20` \| `BEP20` |
| `currency` | String | `USDT` |
| `createdAt` / `updatedAt` | Date | Auto |

**Indexes:** `trnId unique`, `user`, `userid`, `status`, `referenceId`, `user+status`, `user+createdAt`

### Get Exchange Rate (User)

#### Endpoint: `GET /api/user/payin/exchange`
- **Description:** Fetch current exchange rate. Single rate, no currency/network params.
- **Headers:** `Authorization: Bearer <token>` (optional — works without token too)
- **Response:**
  ```json
  { "success": true, "rate": 112 }
  ```

---

## Payout (User)

### Get Payout Switch Status

#### Endpoint: `GET /api/user/payout-switch`
- **Description:** Get current payout switch status for the logged-in user.
- **Headers:** `Authorization: Bearer <token>`
- **Response (200):**
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
- **Request Body:**
  ```json
  {
    "withdrawal": true
  }
  ```
- **Response (200):**
  ```json
  {
    "success": true,
    "msg": "Payout enabled",
    "withdrawal": true
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "withdrawal must be boolean" }`
  - 400: `{ "success": "failed", "msg": "Add and enable a bank account first" }`
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to update payout switch" }`

---

## Flow

### USDT (Crypto) Payin
1. `POST /api/user/payin` → `Payin pending` (no Transaction created)
2. User sends USDT on chain to `address`
3. Admin approves → `POST /api/admin/payins/:payinId/approve` → creates `Transaction (credit, success)` with `balanceAfter = old + amount * exchangeRate`
4. `GET /api/user/balance` → reflects credited amount

### INR (SimplyPay) Payin
1. `POST /api/user/simplypay/deposit` → `Payin pending` + returns `paymentLink`
2. User opens `paymentLink` → completes payment
3. SimplyPay calls `POST /webhook/simplypay/payin` → auto-creates `Transaction (credit, success)` with `balanceAfter = old + amount`
4. `GET /api/user/balance` → reflects credited amount (no admin approval needed)
