const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/userController');
const { addBank, getBanks, updateBankStatus } = require('../controllers/bankController');
const { createPayin, getPayinList, getTransactions, getBalance, submitPayinTxHash } = require('../controllers/payinController');
const { getPayinExchangeRate } = require('../controllers/payinExchangeController');
const { togglePayoutStatus, getPayoutSwitch } = require('../controllers/payoutController');
const { getBonusConfig } = require('../controllers/adminBonusController');
const homeController = require('../controllers/homeController');
const simplypayController = require('../controllers/simplypayController');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

router.post('/register', register);
router.post('/login', login);

// Exchange rate - single endpoint, no currency param, returns current rate
// GET /api/user/payin/exchange -> { success:true, rate:112 }
// optionalAuth: works without token (public) and with valid Bearer token; invalid token -> 401
router.get('/payin/exchange', optionalAuth, getPayinExchangeRate);

// Payin - creates pending payin (no transaction until approved)
router.post('/payin', auth, createPayin);
router.post('/payin/submit-tx', auth, submitPayinTxHash);
router.get('/payins', auth, getPayinList);
router.get('/transactions', auth, getTransactions);
router.get('/balance', auth, getBalance);

// Home dashboard
router.get('/home', auth, homeController.getHome);

// Bank routes - auth required, multiple banks per user
router.post('/bankadd', auth, addBank);
router.get('/banklist', auth, getBanks);
router.patch('/bankstatus', auth, updateBankStatus);

// Payout routes
router.get('/payout-switch', auth, getPayoutSwitch);
router.patch('/payout-switch', auth, togglePayoutStatus);

// SimplyPay INR deposit
router.post('/simplypay/deposit', auth, simplypayController.createPayin);

// Bonus config (public - users can see current bonus rates)
router.get('/bonus-config', optionalAuth, getBonusConfig);

module.exports = router;