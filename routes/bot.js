const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const {
  health,
  listGroups,
  getGroup,
  updateGroupStatus,
  adjustGroup,
  listOrders,
  getOrder,
  approveOrder,
  rejectOrder,
  getStats,
} = require('../controllers/botController');

router.get('/health', health);

router.get('/groups', auth, requireAdmin, listGroups);
router.get('/groups/:groupId', auth, requireAdmin, getGroup);
router.patch('/groups/:groupId/status', auth, requireAdmin, updateGroupStatus);
router.post('/groups/:groupId/adjust', auth, requireAdmin, adjustGroup);

router.get('/orders', auth, requireAdmin, listOrders);
router.get('/orders/:orderId', auth, requireAdmin, getOrder);
router.post('/orders/:orderId/approve', auth, requireAdmin, approveOrder);
router.post('/orders/:orderId/reject', auth, requireAdmin, rejectOrder);

router.get('/stats/:groupId', auth, requireAdmin, getStats);

module.exports = router;
