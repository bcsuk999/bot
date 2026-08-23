const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  inviteCode: {
    type: String,
    default: null
  },
  userid: {
    type: Number,
    unique: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'ban', 'suspend'],
    default: 'active'
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);