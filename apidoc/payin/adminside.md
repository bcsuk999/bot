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

Manage USDT deposit addresses per network. When user calls `POST /api/user/payin` the backend uses the active address for that network (`DepositAddress` collection, fallback to defaults).

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
  { "network": "TRC20", "address": "TXYZ...", "label": "Main TRC20", "isActive": true }
  ```
  `currency` defaults to `USDT` (only USDT allowed). If `isActive:true`, previous active for same `USDT+network` is auto-deactivated (unique active per network).
- **Response (201):**
  ```json
  { "success": true, "msg": "Deposit address created", "address": { "_id":"...", "network":"TRC20", "address":"TXYZ...", "isActive": true } }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "network and address are required" }`
  - 400: `{ "success": "failed", "msg": "Invalid TRC20 address format" }` / `Invalid BEP20 address format`
  - 422: `{ "success": "failed", "msg": "Address already exists" }`

### Update Deposit Address
#### Endpoint: `PATCH /api/admin/deposit-addresses/:id`
- **Request Body (all optional):** `{ "network": "BEP20", "address": "0x...", "label": "new", "isActive": false, "currency": "USDT" }`
- **Response (200):** `{ "success": true, "msg": "Deposit address updated", "address": {...} }`
- **Errors:** 404 not found, 400 invalid format, 422 duplicate

### Toggle Active
#### Endpoint: `PATCH /api/admin/deposit-addresses/:id/toggle`
- **Request Body:** `{ "isActive": true }` or `{ "isActive": false }`
- If activating, other active for same network is auto-deactivated.
- **Response:** `{ "success": true, "msg": "Deposit address activated", "address": {...} }`

### Delete Deposit Address
#### Endpoint: `DELETE /api/admin/deposit-addresses/:id`
- **Response:** `{ "success": true, "msg": "Deposit address deleted" }`
- 404 if not found

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
- **Description:** Approves a `pending` `credit` transaction → sets `status=success`, `balanceAfter = previousSuccessBalance + amount`, updates linked Payin to `success` with `completedAt` and `detectedAmount`.
- **Headers:** `Authorization: Bearer <admin_token>`
- **Request Body (optional):** `{ "txHash": "0x...", "remark": "manual approve" }`
- **Response:**
  ```json
  { "success": true, "msg": "Transaction approved", "transaction": { "trnId":"TXN...", "amount":120, "type":"credit", "note":"payin", "remark":"BEP20 deposit", "balanceAfter":120, "status":"success" } }
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
- **Description:** Reverses a `success` credit transaction. Creates new `debit` reversal entry (`TXN new`) with `balanceAfter = currentBalance - amount`, marks original `status=reversed`, Payin `reversed`.
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

## Pagination Convention
All list endpoints return `{ count: totalDocs, page, limit, totalPages, ... }` with `limit max 100`.
