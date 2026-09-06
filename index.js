const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const userRouter = require('./routes/user');
const adminRouter = require('./routes/admin');
const simplypayController = require('./controllers/simplypayController');
const connectDB = require('./db/conn');
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

connectDB();

app.use('/api/user', userRouter);
app.use('/apii/user', userRouter); // alias for typo /apii/user/payin/exchange
app.use('/api/admin', adminRouter);

// SimplyPay webhook callbacks (no auth - called by gateway)
app.post('/webhook/simplypay/payin', simplypayController.payinCallback);
app.post('/webhook/simplypay/payout', simplypayController.payoutCallback);

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