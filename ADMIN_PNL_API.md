# Admin P&L Report API

## Endpoint: `GET /admin/pnl`

### Description
Generate a Profit & Loss report for the bot, identical to the `/pl` command output. This report shows group-wise deposits, payouts and profit/loss for a given date and cost per USDT.

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
  "groups": 5,
  "report": "UID 12345 | U 160\n[ Payin: ₹10,000.00 | Total: ₹20,000.00 ]\n[ Payout: ₹1,000.00 | Total: ₹5,000.00 ]\n  P/L : 💕 ₹2,752.50\n\n...",
  "chunks": 3,
  "chunkDetails": [
    "UID 12345 | U 160\n[ Payin: ₹10,000.00 | Total: ₹20,000.00 ]\n[ Payout: ₹1,000.00 | Total: ₹5,000.00 ]\n  P/L : 💕 ₹2,752.50",
    "UID 67890 | U 155\n[ Payin: ₹5,000.00 ...",
    "UID 11111 | U 165\n[ Payin: ₹8,000.00 ..."
  ]
}
```

### Error Responses

| Status | Error Message |
|--------|-------------|
| 400 | `date (DD/MM/YY) and cost per USDT are required` |
| 400 | `Invalid date format or cost. Use a positive number, e.g. 107` |
| 400 | `No active groups with an exchange rate set.` (when no groups have rates configured) |
| 500 | `Failed to generate P&L report` |

### Request Example

```http
GET /admin/pnl?date=23/11/26&cost=107
Authorization: Bearer <admin_jwt_token>
```

### Response Fields

- `dateLabel` - The formatted date string (e.g., `23/11/2026`)
- `cost` - The cost per USDT used for the calculation
- `groups` - Number of active groups with exchange rates included in the report
- `report` - Full P&L report text (ready for display, newline-separated blocks)
- `chunks` - Number of chunks the report was split into (Telegram limit: ~4000 chars per message)
- `chunkDetails` - Array of chunk strings (each ≤ 4000 chars). Frontend can iterate and send each as a separate message.

### How it works (same as `/pl`)

1. Parses `date` as an IST day using `parseIstDate`
2. Parses `cost` as the cost per USDT
3. Fetches grouped deposit/payout data from the database (`getGroupPnlRows`)
4. Calculates P&L per group using the exchange rate and cost
5. Renders the report using `renderPnlReport` (same layout as `/pl`)
6. Splits the report into Telegram-sized chunks using `chunkText`
7. Returns all data so the frontend can display or send the messages

### Frontend Integration Notes

- The `report` field contains the full formatted text with emojis and INR formatting
- The `chunks` array allows sending long reports message-by-message (Telegram limit)
- If `groups` is 0, the `report` will contain `No active groups with an exchange rate set.`
- Authentication: use the admin JWT token obtained from `POST /admin/login`