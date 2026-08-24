const DepositAddress = require('../models/DepositAddress');

// Seed defaults if collection empty
const DEFAULT_ADDRESSES = [
  { currency: 'USDT', network: 'TRC20', address: 'TQRcQg2naLxZGxuWCv7E53VgEasRAdPL8v', label: 'USDT TRC20 default', isActive: true },
  { currency: 'USDT', network: 'BEP20', address: '0x4993D6bD7E9b27D5B306F36ec0b4Cea8927BB2fB', label: 'USDT BEP20 default', isActive: true },
];

function validateAddress(network, address) {
  if (network === 'TRC20') {
    // TRC20: starts with T, 34 chars, base58
    if (!/^T[A-Za-z0-9]{33}$/.test(address)) return 'Invalid TRC20 address format';
  }
  if (network === 'BEP20') {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return 'Invalid BEP20 address format';
  }
  return null;
}

async function ensureSeeded() {
  const count = await DepositAddress.countDocuments();
  if (count === 0) {
    for (const a of DEFAULT_ADDRESSES) {
      await DepositAddress.updateOne({ address: a.address }, { $setOnInsert: a }, { upsert: true });
    }
  }
}

exports.listDepositAddresses = async (req, res) => {
  try {
    await ensureSeeded();
    const { network, isActive, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (network && ['TRC20', 'BEP20'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();
    if (isActive !== undefined) filter.isActive = String(isActive) === 'true';

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      DepositAddress.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      DepositAddress.countDocuments(filter),
    ]);

    res.json({ success: true, msg: 'Deposit addresses fetched', count: total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum), addresses: items });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch deposit addresses' });
  }
};

exports.createDepositAddress = async (req, res) => {
  try {
    let { currency, network, address, label, isActive } = req.body;
    currency = currency ? String(currency).toUpperCase() : 'USDT';
    if (!network || !address) return res.status(400).json({ success: 'failed', msg: 'network and address are required' });
    network = String(network).toUpperCase().trim();
    address = String(address).trim();
    if (!['TRC20', 'BEP20'].includes(network)) return res.status(400).json({ success: 'failed', msg: 'network must be TRC20 or BEP20' });
    if (currency !== 'USDT') return res.status(400).json({ success: 'failed', msg: 'currency must be USDT' });
    const errMsg = validateAddress(network, address);
    if (errMsg) return res.status(400).json({ success: 'failed', msg: errMsg });

    const existing = await DepositAddress.findOne({ address }).lean();
    if (existing) return res.status(422).json({ success: 'failed', msg: 'Address already exists' });

    const activeFlag = isActive !== undefined ? Boolean(isActive) : true;
    if (activeFlag) {
      // deactivate previous active for same network+currency
      await DepositAddress.updateMany({ currency, network, isActive: true }, { $set: { isActive: false } });
    }

    const doc = await DepositAddress.create({
      currency,
      network,
      address,
      label: label ? String(label).trim() : '',
      isActive: activeFlag,
      createdBy: req.user.userId,
    });

    res.status(201).json({ success: true, msg: 'Deposit address created', address: doc });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'address';
      return res.status(422).json({ success: 'failed', msg: `${field} already exists or active address for network exists` });
    }
    res.status(500).json({ success: 'failed', msg: 'Failed to create deposit address' });
  }
};

exports.updateDepositAddress = async (req, res) => {
  try {
    const { id } = req.params;
    let { network, address, label, isActive, currency } = req.body;
    const doc = await DepositAddress.findById(id);
    if (!doc) return res.status(404).json({ success: 'failed', msg: 'Deposit address not found' });

    if (currency) {
      currency = String(currency).toUpperCase();
      if (currency !== 'USDT') return res.status(400).json({ success: 'failed', msg: 'currency must be USDT' });
      doc.currency = currency;
    }
    if (network) {
      network = String(network).toUpperCase().trim();
      if (!['TRC20', 'BEP20'].includes(network)) return res.status(400).json({ success: 'failed', msg: 'network must be TRC20 or BEP20' });
      doc.network = network;
    }
    if (address) {
      address = String(address).trim();
      const errMsg = validateAddress(doc.network, address);
      if (errMsg) return res.status(400).json({ success: 'failed', msg: errMsg });
      const dup = await DepositAddress.findOne({ address, _id: { $ne: doc._id } }).lean();
      if (dup) return res.status(422).json({ success: 'failed', msg: 'Address already exists' });
      doc.address = address;
    }
    if (label !== undefined) doc.label = String(label).trim();
    if (isActive !== undefined) {
      const newActive = Boolean(isActive);
      if (newActive && !doc.isActive) {
        await DepositAddress.updateMany({ currency: doc.currency, network: doc.network, isActive: true, _id: { $ne: doc._id } }, { $set: { isActive: false } });
      }
      doc.isActive = newActive;
    }

    await doc.save();
    res.json({ success: true, msg: 'Deposit address updated', address: doc });
  } catch (err) {
    if (err.code === 11000) return res.status(422).json({ success: 'failed', msg: 'Active address for this network already exists' });
    res.status(500).json({ success: 'failed', msg: 'Failed to update deposit address' });
  }
};

exports.deleteDepositAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await DepositAddress.findById(id);
    if (!doc) return res.status(404).json({ success: 'failed', msg: 'Deposit address not found' });
    await DepositAddress.findByIdAndDelete(id);
    res.json({ success: true, msg: 'Deposit address deleted' });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to delete deposit address' });
  }
};

exports.toggleDepositAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (isActive === undefined) return res.status(400).json({ success: 'failed', msg: 'isActive is required' });
    const doc = await DepositAddress.findById(id);
    if (!doc) return res.status(404).json({ success: 'failed', msg: 'Deposit address not found' });
    const newActive = Boolean(isActive);
    if (newActive) {
      await DepositAddress.updateMany({ currency: doc.currency, network: doc.network, isActive: true, _id: { $ne: doc._id } }, { $set: { isActive: false } });
    }
    doc.isActive = newActive;
    await doc.save();
    res.json({ success: true, msg: `Deposit address ${newActive ? 'activated' : 'deactivated'}`, address: doc });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to toggle deposit address' });
  }
};
