/**
 * Manual integration check for the settlement money path. Needs a real MongoDB
 * (transactions are used, so a replica set is required), so it is NOT part of
 * `npm test`.
 *
 *   node tests/settlement.integration.cjs
 *
 * Verifies:
 *   1. a single settlement credits exactly the order face value
 *   2. replaying the same gateway callback does NOT credit twice
 *   3. two concurrent settlements for the same group both land (no lost update)
 *   4. a forced mid-transaction failure leaves the order pending and no ledger row
 */
require('dotenv').config();
require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');
const TelegramGroup = require('../models/TelegramGroup');
const BotOrder = require('../models/BotOrder');
const BotTransaction = require('../models/BotTransaction');
const botGroupService = require('../services/botGroupService');
const { settleSuccess } = require('../controllers/botWebhookController');

const GROUP_ID = '-1009999999999';
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function makeOrder(amount) {
  return BotOrder.create({
    orderId: `ITEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    groupId: GROUP_ID,
    group: await TelegramGroup.findOne({ groupId: GROUP_ID }).then((g) => g._id),
    amount,
    receivedAmount: amount,
    currency: 'INR',
    network: 'SPAY',
    status: 'pending',
  });
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const group = await TelegramGroup.findOneAndUpdate(
    { groupId: GROUP_ID },
    { $setOnInsert: { title: 'itest', status: 'active' } },
    { new: true, upsert: true }
  );
  // Start from a clean ledger so the arithmetic below is exact.
  await BotTransaction.deleteMany({ group: group._id });
  await BotOrder.deleteMany({ group: group._id });
  await TelegramGroup.updateOne({ _id: group._id }, { $set: { totalDeposits: 0, totalCredited: 0 } });

  console.log('\n1. single settlement credits the face value');
  const a = await makeOrder(400);
  const r1 = await settleSuccess(a.orderId, 2);
  const bal1 = await botGroupService.getGroupBalance(group._id);
  check('action = credited', r1.action === 'credited', JSON.stringify(r1));
  check('balance = 400', bal1 === 400, `got ${bal1}`);
  check('order marked success', (await BotOrder.findById(a._id)).status === 'success');
  check('trnId linked to order', !!(await BotOrder.findById(a._id)).trnId);

  console.log('\n2. replaying the same callback does not double-credit');
  const replay = await settleSuccess(a.orderId, 2);
  const bal2 = await botGroupService.getGroupBalance(group._id);
  check('replay did not credit again', bal2 === 400, `got ${bal2}`);
  check('replay reported no-op', replay.action !== 'credited', `got ${replay.action}`);
  const rows2 = await BotTransaction.countDocuments({ group: group._id });
  check('still exactly 1 ledger row', rows2 === 1, `got ${rows2}`);

  console.log('\n3. two concurrent settlements for one group both land');
  const b = await makeOrder(250);
  const c = await makeOrder(150);
  const results = await Promise.allSettled([settleSuccess(b.orderId, 2), settleSuccess(c.orderId, 2)]);
  const bal3 = await botGroupService.getGroupBalance(group._id);
  const rows3 = await BotTransaction.countDocuments({ group: group._id });
  check('both settled without error', results.every((x) => x.status === 'fulfilled'), JSON.stringify(results.map((r) => r.status)));
  check('balance = 400+250+150 = 800', bal3 === 800, `got ${bal3}`);
  check('3 ledger rows', rows3 === 3, `got ${rows3}`);
  check('balanceAfter values are unique', new Set((await BotTransaction.find({ group: group._id }).lean()).map((r) => String(r.balanceAfter))).size === 3);

  console.log('\n4. a crash mid-transaction rolls the whole thing back');
  const d = await makeOrder(999);
  const session = await mongoose.startSession();
  const realCreate = BotTransaction.create.bind(BotTransaction);
  BotTransaction.create = () => { throw new Error('simulated crash after claim'); };
  let threw = null;
  try {
    await settleSuccess(d.orderId, 2);
  } catch (e) {
    threw = e.message;
  } finally {
    BotTransaction.create = realCreate;
    await session.endSession();
  }
  const orderAfter = await BotOrder.findById(d._id);
  const bal4 = await botGroupService.getGroupBalance(group._id);
  check('crash propagated', !!threw, `threw=${threw}`);
  check('order NOT left marked success', orderAfter.status === 'pending', `status=${orderAfter.status}`);
  check('no ledger row written', (await BotTransaction.countDocuments({ group: group._id })) === 3);
  check('balance unchanged at 800', bal4 === 800, `got ${bal4}`);

  console.log('\n5. retry after the crash succeeds (order is still claimable)');
  const r5 = await settleSuccess(d.orderId, 2);
  check('retry credited', r5.action === 'credited', JSON.stringify(r5));
  check('balance = 800+999 = 1799', (await botGroupService.getGroupBalance(group._id)) === 1799);

  // cleanup
  await BotTransaction.deleteMany({ group: group._id });
  await BotOrder.deleteMany({ group: group._id });
  await TelegramGroup.deleteOne({ _id: group._id });
  await mongoose.disconnect();

  console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : '\nAll settlement checks passed.\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('integration check crashed:', e);
  process.exit(1);
});
