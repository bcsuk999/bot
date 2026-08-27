# Admin Side API Documentation

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

## Authentication

### Admin Login

#### Endpoint: `POST /api/admin/login`
- **Description:** Admin login with role verification
- **Request Body:**
  ```json
  {
    "mobile": "string (required)",
    "password": "string (required)"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "msg": "Admin login successful",
    "token": "jwt_token_string",
    "user": {
      "id": "admin_id",
      "mobile": "admin_mobile",
      "role": "admin",
      "status": "active|ban|suspend"
    }
  }
  ```
- **Status:** 200 OK
- **Errors:**
  - 404: `{ "success": "failed", "msg": "Admin not found" }`
  - 400: `{ "success": "failed", "msg": "Invalid admin credentials" }`
  - 500: `{ "success": "failed", "msg": "Failed to login admin" }`

### Update User Status

#### Endpoint: `PATCH /api/admin/users/:userid/status`
- **Description:** Admin can change user status (active/ban/suspend)
- **URL Parameters:**
  - `userid`: Number (the user's unique userid)
- **Request Body:**
  ```json
  {
    "status": "string (required: active|ban|suspend)",
    "remark": "string (required: reason for status change, e.g. 'Violated terms of service')"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "msg": "User status updated successfully",
    "user": {
      "id": "user_id",
      "mobile": "mobile_number",
      "status": "updated_status",
      "remark": "Violated terms of service"
    }
  }
  ```
- **Status:** 200 OK
- **Errors:**
  - 400: `{ "success": "failed", "msg": "Invalid status value" }`
  - 400: `{ "success": "failed", "msg": "remark is required (e.g. reason for status change)" }`
  - 404: `{ "success": "failed", "msg": "User not found" }`
  - 500: `{ "success": "failed", "msg": "Failed to update user status" }`

## Admin Capabilities

- Admin has `role: admin` in the user model
- Admin can change any user's status via the PATCH endpoint
- Admin can login using `/api/admin/login`
- Token expires in 10 days

---

### List / Search Users

#### Endpoint: `GET /api/admin/users`
- **Description:** Search users by `uid` / `mobile`, filter by date range (user `createdAt`), sort by `balance` (highest/lowest). `balance` = `balanceAfter` of last `success` transaction; `totalDeposit` = sum of `creditedAmount` for `success` + `credit` + `payin` transactions.
- **Headers:** `Authorization: Bearer <admin_token>`
- **Query Params (all optional):**
  - `uid`: number (exact `userid` match)
  - `mobile`: string (exact match)
  - `sortBalance`: `asc` (lowest first) | `desc` (highest first)
  - `from` / `to`: date (`YYYY-MM-DD`) — filter user `createdAt` range
  - `page`: number (default 1)
  - `limit`: number (default 20, max 100)
- **Example:** `GET /api/admin/users?mobile=9876543210&sortBalance=desc&from=2026-01-01&to=2026-08-27`
- **Response (200):**
  ```json
  {
    "success": true,
    "msg": "Users fetched",
    "count": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "users": [
      {
        "uid": 3056579,
        "mobile": "9876543210",
        "registerDate": "2026-05-13T00:00:00.000Z",
        "balance": 13440,
        "totalDeposit": 13440,
        "status": "active",
        "remark": null
      }
    ]
  }
  ```
- **Errors:**
  - 401: `{ "success": "failed", "msg": "Unauthorized: ..." }`
  - 403: `{ "success": "failed", "msg": "Forbidden: Admin access required" }`
  - 500: `{ "success": "failed", "msg": "Failed to fetch users" }`