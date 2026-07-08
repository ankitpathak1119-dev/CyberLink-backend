const mongoose = require("mongoose");

const statusCommentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true, lowercase: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const statusSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true, trim: true, lowercase: true, index: true },
    text: { type: String, default: "", trim: true, maxlength: 500 },
    mediaType: {
      type: String,
      enum: ["text", "image", "video", "audio"],
      default: "text",
      index: true,
    },
    mediaPath: { type: String, default: null },
    mediaTitle: { type: String, default: null },
    viewerIds: { type: [String], default: [] },
    likeUserIds: { type: [String], default: [] },
    comments: { type: [statusCommentSchema], default: [] },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

statusSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model("Status", statusSchema);

