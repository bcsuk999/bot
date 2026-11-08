const botGroupService = require('../../botGroupService');
const { getGroupStats } = require('../stats');
const { formatAmount } = require('../format');

// Merchant balance slip. Balance is the live ledger balance, Deposit is what was
// credited today (IST), Frozen is always zero - nothing in this system ever holds
// funds back, so it is a fixed line rather than a query.
async function cmdBalance(ctx) {
  const { group } = ctx;
  const [balance, today] = await Promise.all([
    botGroupService.getGroupBalance(group._id),
    getGroupStats(group._id, 'today'),
  ]);

  const rate = Number(group.exchangeRate);
  const usdt = Number.isFinite(rate) && rate > 0 ? (balance / rate).toFixed(2) : '-';

  return {
    text: [
      'Merchant balance:',
      '',
      `Balance: ${formatAmount(balance)}  | U ${usdt}`,
      `Deposit: ${formatAmount(today.success.amount)}`,
      `Frozen: ${formatAmount(0)}`,
    ].join('\n'),
  };
}

module.exports = { cmdBalance };
