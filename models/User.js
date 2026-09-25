const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    photo: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
