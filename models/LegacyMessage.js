const mongoose = require("mongoose");

const legacyMessageSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["private", "group"],
      required: true,
      index: true,
    },
    conversationKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    from: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    to: {
      type: String,
      trim: true,
      default: "",
    },
    group: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    cipherText: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    authTag: {
      type: String,
      required: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

legacyMessageSchema.index({ kind: 1, conversationKey: 1, sentAt: 1 });

module.exports = mongoose.model("LegacyMessage", legacyMessageSchema);

