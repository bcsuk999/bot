const express = require('express');
const router = express.Router();
const { login, updateUserStatus } = require('../controllers/adminController');
const { listBanks, updateBankStatus } = require('../controllers/adminBankController');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

router.post('/login', login);
router.patch('/users/:userid/status', auth, requireAdmin, updateUserStatus);

// Admin bank management
router.get('/banks', auth, requireAdmin, listBanks);
router.patch('/banks/:bankId/status', auth, requireAdmin, updateBankStatus);

module.exports = router;