const express = require('express');
const router = express.Router();
const { login, updateUserStatus } = require('../controllers/adminController');
const { listBanks, updateBankStatus } = require('../controllers/adminBankController');
const {
  listDepositAddresses,
  createDepositAddress,
  updateDepositAddress,
  deleteDepositAddress,
  toggleDepositAddress,
  seedDefaultAddresses,
} = require('../controllers/adminDepositController');
const {
  adminListPayins,
  adminListTransactions,
  adminGetTransactionByTrnId,
  adminApproveTransaction,
  adminRejectTransaction,
  adminReverseTransaction,
} = require('../controllers/adminPayinController');
const {
  listExchangeRates,
  getCurrentRate,
  upsertExchangeRate,
  updateExchangeRate,
  deleteExchangeRate,
} = require('../controllers/adminExchangeController');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

router.post('/login', login);
router.patch('/users/:userid/status', auth, requireAdmin, updateUserStatus);

// Admin bank management
router.get('/banks', auth, requireAdmin, listBanks);
router.patch('/banks/:bankId/status', auth, requireAdmin, updateBankStatus);

// Admin deposit address config (TRC20/BEP20) - no auto-seed, deleted stays deleted
router.get('/deposit-addresses', auth, requireAdmin, listDepositAddresses);
router.post('/deposit-addresses/seed', auth, requireAdmin, seedDefaultAddresses);
router.post('/deposit-addresses', auth, requireAdmin, createDepositAddress);
router.patch('/deposit-addresses/:id', auth, requireAdmin, updateDepositAddress);
router.patch('/deposit-addresses/:id/toggle', auth, requireAdmin, toggleDepositAddress);
router.delete('/deposit-addresses/:id', auth, requireAdmin, deleteDepositAddress);

// Admin payin / transaction management (by trnId / userid with pagination)
router.get('/payins', auth, requireAdmin, adminListPayins);
router.get('/transactions', auth, requireAdmin, adminListTransactions);
router.get('/transactions/:trnId', auth, requireAdmin, adminGetTransactionByTrnId);
router.post('/transactions/:trnId/approve', auth, requireAdmin, adminApproveTransaction);
router.post('/transactions/:trnId/reject', auth, requireAdmin, adminRejectTransaction);
router.post('/transactions/:trnId/reverse', auth, requireAdmin, adminReverseTransaction);

// Admin exchange rate config (payin amount * rate = credited balance)
router.get('/exchange-rates', auth, requireAdmin, listExchangeRates);
router.get('/exchange-rates/current', auth, requireAdmin, getCurrentRate);
router.post('/exchange-rates', auth, requireAdmin, upsertExchangeRate);
router.patch('/exchange-rates/:id', auth, requireAdmin, updateExchangeRate);
router.delete('/exchange-rates/:id', auth, requireAdmin, deleteExchangeRate);

module.exports = router;