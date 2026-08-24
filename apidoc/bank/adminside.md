# Bank - Admin Side API Documentation

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

## Note
Bank add/list/status are **user-owned** (`/api/user/bank*` with user JWT). Admin does **not** need separate bank endpoints unless you want admin to view all users' banks.
Current implementation: no `POST /api/admin/bank*` — admin can manage users via `PATCH /api/admin/users/:userid/status` and users manage their own banks.

If you want admin bank view later, we can add:

---

### (Optional Future) Admin Get All Banks

#### Endpoint: `GET /api/admin/banks` (not yet implemented — plan ready)
- **Description:** Admin can list all banks across users with filters.
- **Headers:** `Authorization: Bearer <admin_jwt>`
- **Query Params:**
  - `userid`: Number (filter by user)
  - `status`: `enable|disable`
  - `bankName`: string
  - `page`, `limit`: pagination
- **Response (planned 200):**
  ```json
  {
    "success": true,
    "msg": "All banks fetched",
    "count": 10,
    "banks": [
      {
        "_id": "bank_id",
        "user": "user_objectId",
        "userid": 3056579,
        "bankName": "SBI",
        "holderName": "Rahul Sharma",
        "accountNumber": "123456789012",
        "ifsc": "SBIN0001234",
        "status": "enable"
      }
    ]
  }
  ```

---

### (Optional Future) Admin Update Any Bank Status

#### Endpoint: `PATCH /api/admin/banks/:bankId/status` (not yet implemented)
- **Headers:** `Authorization: Bearer <admin_jwt>`
- **Request Body:** `{ "status": "enable|disable" }`
- **Response:** `{ "success": true, "msg": "Bank status updated by admin", "bank": {...} }`

---

## Current Admin Capabilities Related to Banks
- Admin login: `POST /api/admin/login` → token `role: admin`
- Admin can check user exists and banks via `Bank` collection (future aggregation) — currently user must call `/api/user/banklist` themselves.
- To enable admin bank listing, say "add admin bank list" and we will create `controllers/adminBankController.js` + `routes/admin.js` entries.

## Bank Model (same as user side)
See `apidoc/bank/userside.md` for full field table. Indexes: `accountNumber unique`, `bankName`, `user`, `status`, `user+status`.
