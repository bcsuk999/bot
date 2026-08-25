const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/userController');
const { addBank, getBanks, updateBankStatus } = require('../controllers/bankController');
const { createPayin, getPayinList, getTransactions, getBalance } = require('../controllers/payinController');
const { getPayinExchangeRate } = require('../controllers/payinExchangeController');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

router.post('/register', register);
router.post('/login', login);

// Exchange rate - single endpoint, no currency param, returns current rate
// GET /api/user/payin/exchange -> { success:true, rate:112 }
// optionalAuth: works without token (public) and with valid Bearer token; invalid token -> 401
router.get('/payin/exchange', optionalAuth, getPayinExchangeRate);

// Payin - creates pending payin + pending transaction with balanceAfter (no instant credit)
router.post('/payin', auth, createPayin);
router.get('/payins', auth, getPayinList);
router.get('/transactions', auth, getTransactions);
router.get('/balance', auth, getBalance);

// Bank routes - auth required, multiple banks per user
router.post('/bankadd', auth, addBank);
router.get('/banklist', auth, getBanks);
router.patch('/bankstatus', auth, updateBankStatus);

module.exports = router;