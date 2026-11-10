# Admin P&L Report API

## Endpoint: `GET /admin/pnl`

### Description
Generate a Profit & Loss report for the bot. This report shows group-wise deposits, payouts and profit/loss for a given date and cost per USDT, returned as structured JSON so the frontend can render its own UI.

### Authentication
- **Required**: Yes (Admin JWT token via `Authorization: Bearer <token>` header)
- **Role**: `admin`

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | Yes | IST day in `DD/MM/YY` format (e.g., `23/11/26`) |
| `cost` | number | Yes | Cost per USDT in INR (e.g., `107`) |

### Success Response (200)

```json
{
  "success": true,
  "msg": "P&L report generated",
  "dateLabel": "23/11/2026",
  "cost": 107,
  "groups": 3,
  "rows": [
    {
      "groupId": "-1001234567890",
      "uid": 12345,
      "title": "Group title",
      "exchangeRate": 160,
      "todayDeposit": 15200.5,
      "totalDeposit": 45600,
      "todayPayout": 3500,
      "totalPayout": 12800,
      "pnl": 4825.75
    },
    {
      "groupId": "-1009876543210",
      "uid": 67890,
      "title": "Another group",
      "exchangeRate": 155,
      "todayDeposit": 8900,
      "totalDeposit": 26700,
      "todayPayout": 1200,
      "totalPayout": 4500,
      "pnl": 2150
    }
  ],
  "totals": {
    "groups": 3,
    "todayDeposit": 36600.5,
    "totalDeposit": 109800,
    "todayPayout": 7500,
    "totalPayout": 26900,
    "pnl": 12151.75
  }
}
```

### Error Responses

| Status | Error Message |
|--------|-------------|
| 400 | `date (DD/MM/YY) and cost per USDT are required` |
| 400 | `Invalid date format or cost. Use a positive number, e.g. 107` |
| 500 | `Failed to generate P&L report` |

### Request Example

```http
GET /admin/pnl?date=23/11/26&cost=107
Authorization: Bearer <admin_jwt_token>
```

### Response Fields

- `dateLabel` - The formatted date string (e.g., `23/11/2026`)
- `cost` - The cost per USDT used for the calculation
- `groups` - Number of active groups included in the report
- `rows` - Array of per-group objects:
  - `groupId` - Telegram group ID
  - `uid` - Group UID (or `null` if unset)
  - `title` - Telegram group title
  - `exchangeRate` - Admin-set group exchange rate (INR per USDT)
  - `todayDeposit` / `totalDeposit` - Deposits for the selected day / lifetime
  - `todayPayout` / `totalPayout` - Payouts (debit adjustments) for the selected day / lifetime
  - `pnl` - Profit/loss for the day (`null` when the group's rate is not usable)
- `totals` - Aggregated figures across groups with a usable rate:
  - `groups` - Number of groups included in the totals
  - `todayDeposit` / `totalDeposit` / `todayPayout` / `totalPayout` - Sums
  - `pnl` - Total profit/loss

### How it works (same calculation as `/pl`)

1. Parses `date` as an IST day using `parseIstDate`
2. Parses `cost` as the cost per USDT
3. Fetches grouped deposit/payout data from the database (`getGroupPnlRows`)
4. Calculates P&L per group using the exchange rate and cost (`computePnl`)
5. Returns structured JSON per group plus totals (`summarizeRatedRows`)

### Frontend Integration Notes

- Build your own table/UI from the `rows` array; amounts are plain numbers rounded to 2 decimals
- `pnl` is `null` when the group's exchange rate is missing or not usable — show "rate not set" for those
- A group is only included when it is active and has an exchange rate set
- Authentication: use the admin JWT token obtained from `POST /admin/login`