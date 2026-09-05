const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true,
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
  },
  remark: {
    type: String,
    default: null,
  },
withdrawal: {
    type: Boolean,
    default: false,
    index: true,
  }
}, { timestamps: true });

// Proper indexing - optimized for auth queries
userSchema.index({ mobile: 1 }, { unique: true });
userSchema.index({ userid: 1 }, { unique: true });
userSchema.index({ mobile: 1, role: 1 }); // fast admin lookup: findOne({mobile, role})
userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);