# User Side API Documentation

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

## Authentication

### User Registration

#### Endpoint: `POST /api/user/register`
- **Description:** Register a new user with auto-incrementing userid. `inviteCode` is the referrer's UID (`User.userid`); if valid, the new user is linked to that referrer (`referredBy`) for the commission system.
- **Request Body:**
  ```json
  {
    "mobile": "string (required, unique)",
    "password": "string (required)",
    "inviteCode": "string (optional, referrer's userid e.g. 3056579)"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "msg": "User registered successfully",
    "token": "jwt_token_string",
    "uid": 3056579,
    "mobile": "9876543210",
    "balance": 0
  }
  ```
  `uid` is `User.userid` Number, `balance` is wallet `balanceAfter` of last success transaction else 0. `inviteCode` is only the referrer's `userid`; if provided and valid, the new user's `referredBy` is set to that referrer.
- **Status:** 201 Created
- **Errors:**
  - 400: `{ "success": "failed", "msg": "Mobile and password are required" }`
  - 422: `{ "success": "failed", "msg": "User already exists" }`
  - 422: `{ "success": "failed", "msg": "Invalid invite code" }` (inviteCode does not match any active user's userid)
  - 500: `{ "success": "failed", "msg": "Failed to register user" }`

### User Login

#### Endpoint: `POST /api/user/login`
- **Description:** Login user and get JWT token
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
    "msg": "Login successful",
    "token": "jwt_token_string",
    "uid": 3056579,
    "mobile": "9876543210",
    "balance": 9000
  }
  ```
  `uid` is `User.userid` Number, `balance` is current wallet balance (last `success` transaction `balanceAfter` else 0). Removed `user.id` and `role` per requirement; flat fields.
- **Status:** 200 OK
- **Errors:**
  - 404: `{ "success": "failed", "msg": "User not found" }`
  - 400: `{ "success": "failed", "msg": "Invalid credentials" }`
  - 403: `{ "success": "failed", "msg": "Account is ban. Please contact support." }`
  - 403: `{ "success": "failed", "msg": "Account is suspend. Please contact support." }`
  - 500: `{ "success": "failed", "msg": "Failed to login" }`

> **Note:** Banned/suspended users cannot login and are blocked from all protected endpoints (`auth`/`optionalAuth` return `403 Access denied: User is <status>`).

## User Model Fields

| Field | Type | Description |
|-------|------|-------------|
| `userid` | Number | Starts at 3056579, increments by 33 on each new register, unique |
| `mobile` | String | Required, unique mobile number |
| `password` | String | Hashed password |
| `role` | String | `user` or `admin` (default: `user`) |
| `status` | String | `active`, `ban`, or `suspend` (default: `active`) |
| `inviteCode` | String | Referrer's UID passed during registration (stored for reference) |
| `referredBy` | ObjectId | Referrer's User `_id`, set when a valid `inviteCode` is used |
| `createdAt` | Date | Automatically added |
| `updatedAt` | Date | Automatically added |