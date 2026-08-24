const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  inviteCode: {
    type: String,
    default: null,
    index: true,
    sparse: true
  },
  userid: {
    type: Number,
    unique: true,
    index: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'ban', 'suspend'],
    default: 'active',
    index: true
  }
}, { timestamps: true });

// Proper indexing
userSchema.index({ mobile: 1 }, { unique: true });
userSchema.index({ userid: 1 }, { unique: true });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);