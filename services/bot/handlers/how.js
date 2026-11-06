// Step-by-step deposit guide shown by /how. Kept as plain text so it renders
// exactly the same in every Telegram client.
const HOW_TO_USE = [
  'HOW TO USE THE DEPOSIT BOT',
  '',
  '1) Create an order',
  'Send: /deposit 500',
  '',
  '2) Get the payment details',
  'The bot will reply with:',
  '• Order ID',
  '• Amount to pay',
  '• UPI ID',
  '• Expiry time',
  '',
  '3) Pay the exact amount',
  'Transfer the exact amount shown — including decimals — to the UPI ID provided.',
  'Use this order for one payment only.',
  '',
  '4) Automatic confirmation',
  'After the transfer, the bot verifies the payment and notifies the group automatically once it is confirmed. No screenshot or manual proof is required.',
  '',
  '5) If confirmation does not arrive',
  'If you have transferred the funds but the bot does not confirm the order, provide us with the UTR (transaction reference) or a payment screenshot. We will check it manually and process the deposit once the funds are received.',
  '',
  '⚠️ IMPORTANT',
  '• Pay the exact amount. A different amount may not be confirmed.',
  '• Do not reuse the same order for multiple payments.',
  '• Each order expires 20 minutes after it is created.',
  '• You do not need to verify the payee name if the UPI ID and amount are correct.',
  '',
  'COMMANDS',
  '/start — Bot information and command list',
  '/balance — Group wallet balance',
  '/deposit <amount> — Create a deposit order',
  '/status <order id> — Check a deposit status',
  '/daily — Deposit success rate (10m / 30m / 1h / today)',
].join('\n');

function cmdHow() {
  return { text: HOW_TO_USE };
}

module.exports = { cmdHow, HOW_TO_USE };
