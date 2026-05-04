const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    unique: true,
    index: true,
  },
  phone: {
    type: String,
    trim: true,
    sparse: true,
    unique: true,
    index: true,
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
