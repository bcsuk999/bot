# User Side API Documentation

## Base URL
```
https://subnpaybackend.onrender.com
Local: http://localhost:5000
```

## Authentication

### User Registration

#### Endpoint: `POST /api/user/register`
- **Description:** Register a new user with auto-incrementing userid
- **Request Body:**
  ```json
  {
    "mobile": "string (required, unique)",
    "password": "string (required)",
    "inviteCode": "string (optional)"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "msg": "User registered successfully",
    "token": "jwt_token_string"
  }
  ```
- **Status:** 201 Created
- **Errors:**
  - 400: `{ "success": "failed", "msg": "Mobile and password are required" }`
  - 422: `{ "success": "failed", "msg": "User already exists" }`
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
    "user": {
      "id": "user_id",
      "mobile": "mobile_number",
      "role": "user|admin",
      "status": "active|ban|suspend"
    }
  }
  ```
- **Status:** 200 OK
- **Errors:**
  - 404: `{ "success": "failed", "msg": "User not found" }`
  - 400: `{ "success": "failed", "msg": "Invalid credentials" }`
  - 500: `{ "success": "failed", "msg": "Failed to login" }`

## User Model Fields

| Field | Type | Description |
|-------|------|-------------|
| `userid` | Number | Starts at 3056579, increments by 33 on each new register, unique |
| `mobile` | String | Required, unique mobile number |
| `password` | String | Hashed password |
| `role` | String | `user` or `admin` (default: `user`) |
| `status` | String | `active`, `ban`, or `suspend` (default: `active`) |
| `createdAt` | Date | Automatically added |
| `updatedAt` | Date | Automatically added |