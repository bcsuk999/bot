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
- **Description:** Create a USDT payin for TRC20 or BEP20. Does **NOT** credit balance instantly — creates `Payin` with `status=pending` and a `Transaction` with `type=credit, status=pending, balanceAfter=currentBalance`. Balance is credited only after blockchain confirmation (admin confirm in Phase 2).
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "amount": 120,
    "network": "BEP20"
  }
  ```
  Aliases accepted: `amt` for `amount`, `net` for `network`. `currency` defaults to `USDT` (only `USDT` allowed).
  ```json
  { "amt": 120, "net": "TRC20" }
  { "amount": 120, "network": "TRC20", "currency": "USDT" }
  ```
- **Validation:**
  - `amount` / `amt` required, must be number `>0`
  - `network` / `net` required, must be `TRC20` or `BEP20` (case-insensitive, stored uppercase)
  - `currency` if sent must be `USDT`
- **Deposit Addresses (hardcoded Phase 1):**
  - `TRC20` → `TQRcQg2naLxZGxuWCv7E53VgEasRAdPL8v`
  - `BEP20` → `0x4993D6bD7E9b27D5B306F36ec0b4Cea8927BB2fB`
  - Phase 2 will make these admin-editable via `DepositAddress` collection.
- **Response Success (201):**
  ```json
  {
    "success": true,
    "msg": "Payin created",
    "payin": {
      "id": "PAY202608240001",
      "currency": "USDT",
      "amount": 120,
      "network": "BEP20",
      "address": "0x4993D6bD7E9b27D5B306F36ec0b4Cea8927BB2fB",
      "status": "pending",
      "transactionType": "payin",
      "remark": "USDT BEP20 deposit"
    },
    "transaction": {
      "trnId": "TXN202608240001",
      "amount": 120,
      "type": "credit",
      "note": "payin",
      "remark": "BEP20 deposit",
      "balanceAfter": 0,
      "status": "pending",
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:00:00.000Z"
    }
  }
  ```
  Note: `balanceAfter` in pending txn = current balance **before** credit (unchanged). After admin confirm success, a new `balanceAfter` will be `old + amount`.
- **Errors:**
  - 400: `{ "success": "failed", "msg": "amount and network are required" }`
  - 400: `{ "success": "failed", "msg": "currency must be USDT" }`
  - 400: `{ "success": "failed", "msg": "Invalid amount" }`
  - 400: `{ "success": "failed", "msg": "network must be TRC20 or BEP20" }`
  - 400: `{ "success": "failed", "msg": "Deposit address not configured for TRC20" }`
  - 401: `{ "success": "failed", "msg": "Unauthorized: No token provided" }`
  - 409: `{ "success": "failed", "msg": "Duplicate payin, please retry" }`
  - 500: `{ "success": "failed", "msg": "Failed to create payin" }`

---

### List Payins

#### Endpoint: `GET /api/user/payins`
- **Description:** Get all payins for logged-in user, newest first.
- **Headers:** `Authorization: Bearer <token>`
- **Response Success (200):**
  ```json
  {
    "success": true,
    "msg": "Payins fetched",
    "count": 2,
    "payins": [
      {
        "payinId": "PAY202608240001",
        "currency": "USDT",
        "network": "BEP20",
        "amount": 120,
        "address": "0x4993...",
        "status": "pending",
        "transactionType": "payin",
        "remark": "USDT BEP20 deposit",
        "createdAt": "..."
      }
    ]
  }
  ```
- **Errors:**
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to fetch payins" }`

---

### List Transactions

#### Endpoint: `GET /api/user/transactions`
- **Description:** Ledger history for logged-in user, newest first. Every transaction contains `balanceAfter` (wallet after that row).
- **Headers:** `Authorization: Bearer <token>`
- **Response Success (200):**
  ```json
  {
    "success": true,
    "msg": "Transactions fetched",
    "count": 2,
    "transactions": [
      {
        "trnId": "TXN202608240002",
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

#### Endpoint: `GET /api/user/exchange-rate?currency=USDT&network=BEP20`
- **Description:** Fetch current active exchange rate. Returns network-specific else global else `1`. `rate` is what multiplies payin amount into balance.
- **Headers:** `Authorization: Bearer <token>`
- **Response:**
  ```json
  { "success": true, "currency":"USDT", "network":"BEP20", "rate":90 }
  ```

---

## Flow (Why balance not instant)
1. `POST /api/user/payin` → `Payin pending` + `Transaction pending, balanceAfter = old balance`
2. User sends USDT on chain to `address`
3. Admin verifies `txHash` → `POST /api/admin/transactions/:trnId/approve` with optional `{"exchangeRate":90}` else uses configured rate → `creditedAmount = amount * rate`, `balanceAfter = old + creditedAmount`
4. `GET /api/user/balance` → `{"success":true,"balance":9000}` reflects multiplied amount
