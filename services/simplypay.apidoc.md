# SimplyPay (PaySimply) API Documentation

## Base URL

```
https://api.paysimply.net/api/v2
```

## Auth

- `appId` — your app ID
- `sign` — SHA-256 signature (all params sorted + `&key={secret}`)

---

## Create Payment Order (PayIn)

**POST** `/api/v2/payment/order/create`

### Request

```json
{
  "appId": "c8da3307f66655642e2f6e7beaf970d5",
  "merOrderNo": "ODR2509051430AB",
  "currency": "INR",
  "amount": "200",
  "returnUrl": "https://backend-ledger-0ra6.onrender.com",
  "notifyUrl": "https://backend-ledger-0ra6.onrender.com/api/payment/callback",
  "attach": "deposit_ODR2509051430AB",
  "extra": {
    "name": "User",
    "email": "123@example.com",
    "mobile": "9999999999"
  },
  "sign": "sha256_hash"
}
```

### Response (code: 0 = success)

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "orderStatus": 1,
    "orderNo": "20250905123456789",
    "merOrderNo": "ODR2509051430AB",
    "amount": 200,
    "currency": "INR",
    "createTime": 1725534600000,
    "updateTime": 1725534600000,
    "params": {
      "paymentLink": "https://...",
      "deepLink": "upi://..."
    },
    "sign": "..."
  }
}
```

### Order Status Codes

| Status | Meaning |
|--------|---------|
| 0, 1, -4 | PENDING |
| 2, 3 | SUCCESS |
| -1, -2 | FAILED |
| -3 | REFUNDED |

---

## Create Payout Order (PayOut)

**POST** `/api/v2/payout/order/create`

### Request (UPI)

```json
{
  "appId": "...",
  "merOrderNo": "WD2509051430AB",
  "currency": "INR",
  "amount": "500",
  "notifyUrl": "...",
  "attach": "withdraw_WD2509051430AB",
  "extra": {
    "payoutType": "UPI",
    "vpa": "user@upi",
    "name": "User",
    "email": "...",
    "mobile": "9999999999"
  },
  "sign": "..."
}
```

### Request (Bank/IFSC)

```json
{
  "appId": "...",
  "merOrderNo": "WD2509051430AB",
  "currency": "INR",
  "amount": "500",
  "notifyUrl": "...",
  "attach": "withdraw_WD2509051430AB",
  "extra": {
    "payoutType": "IFSC",
    "ifsc": "SBIN0001234",
    "account": "1234567890",
    "name": "User",
    "email": "...",
    "mobile": "9999999999"
  },
  "sign": "..."
}
```

---

## Query Order Status

**GET** `/api/v2/payment/order/query?appId=...&merOrderNo=...&sign=...`

### Response

```json
{
  "code": 0,
  "data": {
    "orderStatus": 2,
    "orderNo": "...",
    "merOrderNo": "...",
    "amount": 200,
    "currency": "INR"
  }
}
```

---

## Signature Generation

```javascript
// 1. Sort all params (excluding `sign`) alphabetically
// 2. For nested objects: "key=subkey1=val1&subkey2=val2"
// 3. Join with "&"
// 4. Append "&key={SECRET}"
// 5. SHA-256 hash
```

---

## Callback (Webhook)

Gateway POSTs to your `notifyUrl` with the same response structure. Verify with `verifyCallbackSign()`, respond with `200` and body `success`.

### Callback Payload

```json
{
  "code": 0,
  "data": {
    "orderStatus": 2,
    "merOrderNo": "ODR...",
    "orderNo": "2025...",
    "amount": 200,
    "currency": "INR"
  },
  "sign": "..."
}
```
