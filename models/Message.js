const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    text: { type: String, required: true, maxlength: 2000 },
    user: {
      id: { type: String, required: true },
      name: { type: String, required: true },
      photo: { type: String, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', MessageSchema);
