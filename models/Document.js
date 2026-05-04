const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ["aadhaar", "pan"],
    required: true,
  },
  fileUrl: { type: String },
  publicId: { type: String },
  status: {
    type: String,
    enum: ["pending", "processing", "verified", "failed"],
    default: "pending",
    index: true,
  },
  extractedData: { type: mongoose.Schema.Types.Mixed, default: {} },
  failureReason: { type: String },
  uploadedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
});

documentSchema.index({ userId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model("Document", documentSchema);
