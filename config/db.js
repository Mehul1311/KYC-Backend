const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("Missing MONGO_URI");
  }

  try {
    await mongoose.connect(uri);
    console.log("[DB]", "Connected");
    return mongoose.connection;
  } catch (err) {
    console.error("[DB]", "Error");
    console.error("[DB]", err);
    throw err;
  }
}

module.exports = { connectDB };
