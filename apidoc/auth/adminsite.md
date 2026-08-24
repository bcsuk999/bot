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
    "status": "string (required: active|ban|suspend)"
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
      "status": "updated_status"
    }
  }
  ```
- **Status:** 200 OK
- **Errors:**
  - 400: `{ "success": "failed", "msg": "Invalid status value" }`
  - 404: `{ "success": "failed", "msg": "User not found" }`
  - 500: `{ "success": "failed", "msg": "Failed to update user status" }`

## Admin Capabilities

- Admin has `role: admin` in the user model
- Admin can change any user's status via the PATCH endpoint
- Admin can login using `/api/admin/login`
- Token expires in 10 days