const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/userController');
const { addBank, getBanks, updateBankStatus } = require('../controllers/bankController');
const auth = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);

// Bank routes - auth required, multiple banks per user
router.post('/bankadd', auth, addBank);
router.get('/banklist', auth, getBanks);
router.patch('/bankstatus', auth, updateBankStatus);

module.exports = router;