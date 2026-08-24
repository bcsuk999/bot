const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/userController');
const { addBank, getBanks, updateBankStatus } = require('../controllers/bankController');
const { createPayin, getPayinList, getTransactions, getBalance } = require('../controllers/payinController');
const { getCurrentRate } = require('../controllers/adminExchangeController');
const { getPayinExchangeRate } = require('../controllers/payinExchangeController');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

router.post('/register', register);
router.post('/login', login);

// Payin exchange rate - MUST be /api/user/payin/exchange, admin-changeable
// GET /api/user/payin/exchange -> { success:true, status:"success", rate:112 }  [1$ = 112 INR]
// Rate is fetched from ExchangeRate collection (admin via POST /api/admin/exchange-rates); fallback 112 if not configured
// optionalAuth: works without token (public) and with valid Bearer token; invalid token -> 401
router.get('/payin/exchange', optionalAuth, getPayinExchangeRate);

// Payin - creates pending payin + pending transaction with balanceAfter (no instant credit)
router.post('/payin', auth, createPayin);
router.get('/payins', auth, getPayinList);
router.get('/transactions', auth, getTransactions);
router.get('/balance', auth, getBalance);
router.get('/exchange-rate', auth, getCurrentRate);

// Bank routes - auth required, multiple banks per user
router.post('/bankadd', auth, addBank);
router.get('/banklist', auth, getBanks);
router.patch('/bankstatus', auth, updateBankStatus);

module.exports = router;