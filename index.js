const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const userRouter = require('./routes/user');
const adminRouter = require('./routes/admin');
const botRouter = require('./routes/bot');
const simplypayController = require('./controllers/simplypayController');
const botWebhookController = require('./controllers/botWebhookController');
const connectDB = require('./db/conn');
const { startBot, stopBot, processWebhookUpdate } = require('./services/bot/client');
const botGroupService = require('./services/botGroupService');
const logger = require('./utils/logger');

const app = express();

// CORS - allow specific origins + global access
const allowedOrigins = [
  'http://localhost:3001',
  'https://subnpayadminio.vercel.app',
  'http://localhost:5173',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (curl, Postman, mobile apps)
      if (!origin) return callback(null, true);
      // allow explicitly listed origins
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // allow any other origin globally (per requirement "allow global url")
      // To restrict to only allowedOrigins, change next line to: return callback(new Error('Not allowed by CORS'), false);
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ type: '*/*' }));

app.use('/api/user', userRouter);
app.use('/apii/user', userRouter); // alias for typo /apii/user/payin/exchange
app.use('/api/admin', adminRouter);
app.use('/api/bot', botRouter);

// SimplyPay webhook callbacks (no auth - called by gateway)
app.post('/webhook/simplypay/payin', simplypayController.payinCallback);
app.post('/webhook/simplypay/payout', simplypayController.payoutCallback);
app.post('/webhook/simplypay/bot', botWebhookController.botPayinCallback);

// Telegram update receiver for BOT_MODE=webhook. The secret in the path is the
// only thing stopping anyone on the internet from POSTing forged updates, so it
// is compared before anything is handed to the bot.
app.post('/bot/telegram/:secret', (req, res) => {
  const expected = process.env.BOT_WEBHOOK_SECRET;
  if (!expected || req.params.secret !== expected) {
    return res.status(403).json({ success: 'failed', msg: 'Forbidden' });
  }
  if (!processWebhookUpdate(req.body)) {
    return res.status(503).json({ success: 'failed', msg: 'Bot not running' });
  }
  return res.status(200).json({ success: true });
});

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    msg: 'Server is running',
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: 'failed',
    msg: 'Route not found',
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server running');
});

// Bot starts only after the DB is connected. A bot failure must not take the
// HTTP server down, so startBot never throws.
connectDB()
  .then(async () => {
    // Give every pre-existing group a 5-digit uid before serving requests.
    await botGroupService
      .backfillGroupUids()
      .catch((err) => logger.error({ err }, 'bot: group uid backfill failed'));
    // Adjustment orders written before `direction` existed: without this, a
    // manual debit already in the DB keeps counting as a deposit.
    await botGroupService
      .backfillOrderDirections()
      .catch((err) => logger.error({ err }, 'bot: order direction backfill failed'));
    return startBot();
  })
  .catch((err) => logger.error({ err }, 'Bot start skipped (DB not ready)'));

process.on('SIGTERM', () => {
  stopBot().finally(() => process.exit(0));
});
process.on('SIGINT', () => {
  stopBot().finally(() => process.exit(0));
});