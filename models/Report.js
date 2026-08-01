const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: String, required: true, trim: true },
    reported: { type: String, required: true, trim: true },
    reason: { type: String, default: "", trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model("Report", reportSchema);
