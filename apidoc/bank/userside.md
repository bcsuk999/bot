# Bank - User Side API Documentation

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

## Authentication
All bank endpoints require `Authorization: Bearer <jwt>` header (login via `POST /api/user/login`).
If missing/invalid → `401 { "success": "failed", "msg": "Unauthorized: ..." }`

---

### Add Bank

#### Endpoint: `POST /api/user/bankadd`
- **Description:** User can add multiple banks. `accountNumber` is globally unique + indexed, `bankName` is indexed but can be same across users.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "bankName": "string (required, indexed, e.g. SBI, HDFC)",
    "holderName": "string (required)",
    "accountNumber": "string (required, unique, indexed)",
    "ifsc": "string (required, e.g. SBIN0001234)"
  }
  ```
- **Response Success (201):**
  ```json
  {
    "success": true,
    "msg": "Bank added successfully",
    "bank": {
      "_id": "bank_id",
      "user": "user_objectId",
      "userid": 3056579,
      "bankName": "SBI",
      "holderName": "Rahul Sharma",
      "accountNumber": "123456789012",
      "ifsc": "SBIN0001234",
      "status": "enable",
      "createdAt": "2026-05-13T00:00:00.000Z",
      "updatedAt": "2026-05-13T00:00:00.000Z"
    }
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "bankName, holderName, accountNumber and ifsc are required" }`
  - 400: `{ "success": "failed", "msg": "Invalid IFSC format" }`
  - 422: `{ "success": "failed", "msg": "Account number already exists" }`
  - 401: `{ "success": "failed", "msg": "Unauthorized: No token provided" }`
  - 500: `{ "success": "failed", "msg": "Failed to add bank" }`

---

### Get Bank List

#### Endpoint: `GET /api/user/banklist`
- **Description:** Get list of logged-in user's banks (multiple). Optional filter by status.
- **Headers:**
  ```
  Authorization: Bearer <token>
  ```
- **Query Params (optional):**
  - `status`: `enable` | `disable`
  - Example: `GET /api/user/banklist?status=enable`
- **Response Success (200):**
  ```json
  {
    "success": true,
    "msg": "Banks fetched",
    "count": 2,
    "banks": [
      {
        "_id": "bank_id_1",
        "bankName": "SBI",
        "holderName": "Rahul Sharma",
        "accountNumber": "123456789012",
        "ifsc": "SBIN0001234",
        "status": "enable",
        "createdAt": "..."
      }
    ]
  }
  ```
- **Errors:**
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to fetch banks" }`

---

### Update Bank Status (Enable/Disable)

#### Endpoint: `PATCH /api/user/bankstatus`
- **Description:** Change own bank status between `enable` and `disable`. User can only update his own banks.
- **Headers:**
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- **Request Body (one of `bankId` or `accountNumber` required):**
  ```json
  {
    "bankId": "bank_objectId (optional if accountNumber given)",
    "accountNumber": "string (optional if bankId given)",
    "status": "enable | disable (required)"
  }
  ```
  Examples:
  ```json
  { "bankId": "665a...", "status": "disable" }
  { "accountNumber": "123456789012", "status": "enable" }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "msg": "Bank status updated successfully",
    "bank": {
      "_id": "bank_id",
      "bankName": "SBI",
      "accountNumber": "123456789012",
      "status": "disable"
    }
  }
  ```
- **Errors:**
  - 400: `{ "success": "failed", "msg": "Status must be enable or disable" }`
  - 400: `{ "success": "failed", "msg": "bankId or accountNumber is required" }`
  - 404: `{ "success": "failed", "msg": "Bank not found" }`
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 500: `{ "success": "failed", "msg": "Failed to update bank status" }`

---

## Bank Model Fields

| Field | Type | Description |
|-------|------|-------------|
| `user` | ObjectId | Ref to User `_id`, indexed |
| `userid` | Number | Denormalized `User.userid`, indexed |
| `bankName` | String | Required, **indexed (not unique)**, many users can have SBI |
| `holderName` | String | Required, account holder name |
| `accountNumber` | String | Required, **unique + indexed** globally |
| `ifsc` | String | Required, uppercase, format `^[A-Z]{4}0[A-Z0-9]{6}$` |
| `status` | String | `enable` \| `disable` (default `enable`), indexed |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Indexes:** `accountNumber unique`, `bankName`, `user`, `userid`, `status`, `user+status`, `user+createdAt`
