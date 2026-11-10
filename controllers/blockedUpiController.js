const blockedUpiService = require('../services/blockedUpiService');

function fail(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ success: 'failed', msg: err.message });
  return res.status(500).json({ success: 'failed', msg: fallback });
}

exports.listBlockedUpis = async (req, res) => {
  try {
    const items = await blockedUpiService.listBlocked();
    return res.json({ success: true, msg: 'Blocked UPIs fetched', count: items.length, data: items });
  } catch (err) {
    return fail(res, err, 'Failed to fetch blocked UPIs');
  }
};

exports.blockUpi = async (req, res) => {
  try {
    const { upiId, reason } = req.body || {};
    const doc = await blockedUpiService.blockUpi(upiId, {
      reason,
      createdBy: req.user?.userid ?? null,
    });
    return res.status(201).json({ success: true, msg: 'UPI blocked', data: doc });
  } catch (err) {
    return fail(res, err, 'Failed to block UPI');
  }
};

exports.unblockUpi = async (req, res) => {
  try {
    const removed = await blockedUpiService.unblockUpi(req.params.upiId);
    if (!removed) return res.status(404).json({ success: 'failed', msg: 'UPI not found in blocklist' });
    return res.json({ success: true, msg: 'UPI unblocked' });
  } catch (err) {
    return fail(res, err, 'Failed to unblock UPI');
  }
};
