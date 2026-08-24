const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/userController');
const { addBank, getBanks, updateBankStatus } = require('../controllers/bankController');
const { createPayin, getPayinList, getTransactions, getBalance } = require('../controllers/payinController');
const auth = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);

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