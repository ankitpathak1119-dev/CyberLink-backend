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
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
      index: true,
    },
    starredBy: {
      type: [String],
      default: [],
      index: true,
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
    isForwarded: {
      type: Boolean,
      default: false,
    },
    replyTo: {
      type: Object, // { messageId, text, sender }
      default: null,
    },
    reactions: {
      type: Array, // [{ user, emoji, createdAt }]
      default: [],
    },
    deletedForEveryone: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

legacyMessageSchema.index({ kind: 1, conversationKey: 1, sentAt: 1 });

module.exports = mongoose.model("LegacyMessage", legacyMessageSchema);
