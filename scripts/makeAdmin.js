require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Usage: node scripts/makeAdmin.js <email>");
  }

  if (!process.env.MONGO_URI) {
    throw new Error("Missing MONGO_URI in environment");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const r = await User.updateOne({ email }, { $set: { role: "admin" } });
  const u = await User.findOne({ email }).lean();
  await mongoose.disconnect();

  return { matched: r.matchedCount, modified: r.modifiedCount, user: u };
}

main()
  .then((out) => {
    console.log(
      JSON.stringify(
        {
          matched: out.matched,
          modified: out.modified,
          user: out.user ? { email: out.user.email, role: out.user.role, uid: out.user.uid } : null,
        },
        null,
        2
      )
    );
  })
  .catch((e) => {
    console.error(e?.stack || e?.message || String(e));
    process.exitCode = 1;
  });

