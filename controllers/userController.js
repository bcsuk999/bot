const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('../db/conn');

exports.register = async (req, res) => {
  try {
    const { mobile, password, inviteCode } = req.body;
    
    if (!mobile || !password) {
      return res.status(400).json({ error: 'Mobile and password are required' });
    }

    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(422).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const lastUser = await User.findOne().sort({ userid: -1 });
    const newUserid = lastUser ? lastUser.userid + 33 : 3056579;

    const user = new User({
      mobile,
      password: hashedPassword,
      inviteCode: inviteCode || null,
      userid: newUserid,
      role: 'user',
      status: 'active'
    });

    await user.save();
    
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    
    res.status(201).json({ message: 'User registered successfully', token });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
};

exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;
    
    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    
    res.json({ message: 'Login successful', token, user: { id: user._id, mobile: user.mobile, role: user.role, status: user.status } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to login' });
  }
};