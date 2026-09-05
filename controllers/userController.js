const User = require('../models/User');
const Counter = require('../models/Counter');
const Transaction = require('../models/Transaction');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('../db/conn');

async function getBalance(userId) {
  const last = await Transaction.findOne({ user: userId, status: 'success' }).sort({ createdAt: -1 }).lean();
  if (last && last.balanceAfter != null) {
    const b = parseFloat(last.balanceAfter.toString());
    return isNaN(b) ? 0 : b;
  }
  return 0;
}

const BASE_USERID = 3056579;
const USERID_STEP = 33;

async function reserveUserId() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'userid' },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  ).lean();

  if (counter.seq !== 1) {
    return BASE_USERID + counter.seq * USERID_STEP;
  }

  const last = await User.findOne().sort({ userid: -1 }).select('userid').lean();
  const base = last && last.userid ? last.userid : BASE_USERID - USERID_STEP;
  const userid = base + USERID_STEP;
  await Counter.updateOne({ _id: 'userid' }, { $set: { seq: (userid - BASE_USERID) / USERID_STEP } });
  return userid;
}

exports.register = async (req, res) => {
  try {
    const { mobile, password, inviteCode } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ success: 'failed', msg: 'Mobile and password are required' });
    }

    const [hashedPassword, firstUserid] = await Promise.all([
      bcrypt.hash(password, 10),
      reserveUserId(),
    ]);

    let user = null;
    let mobileTaken = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const userid = attempt === 0 ? firstUserid : await reserveUserId();
      try {
        user = await User.create({
          mobile,
          password: hashedPassword,
          inviteCode: inviteCode || null,
          userid,
          role: 'user',
          status: 'active',
        });
        break;
      } catch (err) {
        if (err.code !== 11000) throw err;
        if (err.keyPattern && err.keyPattern.mobile) {
          mobileTaken = true;
          break;
        }
      }
    }

    if (mobileTaken) {
      return res.status(422).json({ success: 'failed', msg: 'User already exists' });
    }
    if (!user) {
      return res.status(500).json({ success: 'failed', msg: 'Failed to register user' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.status(201).json({ success: true, msg: 'User registered successfully', token, uid: user.userid, mobile: user.mobile, balance: 0 });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: 'failed', msg: 'Failed to register user' });
  }
};

exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;

    const user = await User.findOne({ mobile }).lean();
    if (!user) {
      return res.status(404).json({ success: 'failed', msg: 'User not found' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: 'failed', msg: `Account is ${user.status}. Please contact support.` });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    const balance = await getBalance(user._id);
    res.json({ success: true, msg: 'Login successful', token, uid: user.userid, mobile: user.mobile, balance });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: 'failed', msg: 'Failed to login' });
  }
};
