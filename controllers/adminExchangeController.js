const ExchangeRate = require('../models/ExchangeRate');

async function getRateFor(currency = 'USDT', network = null) {
  // Exchange rate is same for every channel (global) - ignore network
  const rateDoc = await ExchangeRate.findOne({ currency, network: null, isActive: true }).lean()
    || await ExchangeRate.findOne({ currency, isActive: true }).lean();
  if (rateDoc && rateDoc.rate != null) {
    const r = parseFloat(rateDoc.rate.toString());
    return isNaN(r) ? 1 : r;
  }
  return 1; // default 1 if not configured
}

exports.getRateFor = getRateFor;

exports.listExchangeRates = async (req, res) => {
  try {
    const { currency, network, isActive, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (currency) filter.currency = String(currency).toUpperCase();
    if (network) {
      if (String(network).toLowerCase() === 'global' || String(network).toLowerCase() === 'null') filter.network = null;
      else if (['TRC20', 'BEP20'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();
    }
    if (isActive !== undefined) filter.isActive = String(isActive) === 'true';

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, count] = await Promise.all([
      ExchangeRate.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      ExchangeRate.countDocuments(filter),
    ]);

    const rates = items.map((r) => ({
      ...r,
      rate: r.rate != null ? parseFloat(r.rate.toString()) : r.rate,
    }));

    res.json({ success: true, msg: 'Exchange rates fetched', count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum), rates });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch exchange rates' });
  }
};

exports.getCurrentRate = async (req, res) => {
  try {
    const { currency = 'USDT', network } = req.query;
    const rate = await getRateFor(String(currency).toUpperCase(), network ? String(network).toUpperCase() : null);
    res.json({ success: true, currency: String(currency).toUpperCase(), network: network ? String(network).toUpperCase() : null, rate });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch rate' });
  }
};

exports.upsertExchangeRate = async (req, res) => {
  try {
    let { currency, rate, label, isActive } = req.body;
    // network is ignored - rate is same for every channel (global)
    const netVal = null;
    currency = currency ? String(currency).toUpperCase() : 'USDT';
    if (currency !== 'USDT') return res.status(400).json({ success: 'failed', msg: 'currency must be USDT' });
    if (rate == null) return res.status(400).json({ success: 'failed', msg: 'rate is required' });
    const parsedRate = Number(rate);
    if (!isFinite(parsedRate) || parsedRate <= 0) return res.status(400).json({ success: 'failed', msg: 'Invalid rate' });

    // global rate - deactivate previous global active
    const activeFlag = isActive !== undefined ? Boolean(isActive) : true;
    if (activeFlag) {
      await ExchangeRate.updateMany({ currency, network: null, isActive: true }, { $set: { isActive: false } });
      // also deactivate any per-network actives to keep single global
      await ExchangeRate.updateMany({ currency, network: { $in: ['TRC20', 'BEP20'] }, isActive: true }, { $set: { isActive: false } });
    }

    // upsert global
    let doc = await ExchangeRate.findOne({ currency, network: null });
    if (doc) {
      doc.rate = parsedRate;
      doc.label = label != null ? String(label).trim() : doc.label;
      doc.isActive = activeFlag;
      doc.updatedBy = req.user.userId;
      await doc.save();
    } else {
      doc = await ExchangeRate.create({
        currency,
        network: netVal,
        rate: parsedRate,
        label: label ? String(label).trim() : '',
        isActive: activeFlag,
        updatedBy: req.user.userId,
      });
    }

    const out = doc.toObject({ getters: true });
    out.rate = parseFloat(out.rate.toString());

    res.status(doc ? 200 : 201).json({ success: true, msg: 'Exchange rate saved', rate: out });
  } catch (err) {
    if (err.code === 11000) return res.status(422).json({ success: 'failed', msg: 'Active rate for this network already exists' });
    res.status(500).json({ success: 'failed', msg: 'Failed to save exchange rate' });
  }
};

exports.updateExchangeRate = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await ExchangeRate.findById(id);
    if (!doc) return res.status(404).json({ success: 'failed', msg: 'Exchange rate not found' });

    let { rate, label, isActive, currency } = req.body;
    // network is ignored - global rate only

    if (currency) {
      currency = String(currency).toUpperCase();
      if (currency !== 'USDT') return res.status(400).json({ success: 'failed', msg: 'currency must be USDT' });
      doc.currency = currency;
    }
    doc.network = null;
    if (rate !== undefined) {
      const pr = Number(rate);
      if (!isFinite(pr) || pr <= 0) return res.status(400).json({ success: 'failed', msg: 'Invalid rate' });
      doc.rate = pr;
    }
    if (label !== undefined) doc.label = String(label).trim();
    if (isActive !== undefined) {
      const newActive = Boolean(isActive);
      if (newActive && !doc.isActive) {
        await ExchangeRate.updateMany({ currency: doc.currency, network: doc.network, isActive: true, _id: { $ne: doc._id } }, { $set: { isActive: false } });
      }
      doc.isActive = newActive;
    }
    doc.updatedBy = req.user.userId;
    await doc.save();

    const out = doc.toObject({ getters: true });
    out.rate = parseFloat(out.rate.toString());
    res.json({ success: true, msg: 'Exchange rate updated', rate: out });
  } catch (err) {
    if (err.code === 11000) return res.status(422).json({ success: 'failed', msg: 'Active rate for this network already exists' });
    res.status(500).json({ success: 'failed', msg: 'Failed to update exchange rate' });
  }
};

exports.deleteExchangeRate = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await ExchangeRate.findById(id);
    if (!doc) return res.status(404).json({ success: 'failed', msg: 'Exchange rate not found' });
    await ExchangeRate.findByIdAndDelete(id);
    res.json({ success: true, msg: 'Exchange rate deleted' });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to delete exchange rate' });
  }
};
