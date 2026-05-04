const { admin, initFirebaseAdmin } = require("../config/firebase");
const User = require("../models/User");

function parseAdminEmails() {
  return String(process.env.ADMIN_EMAIL || "")
    .split(/[,\s]+/g)
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);
}

async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1];

    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }

    const initialized = initFirebaseAdmin();
    if (!initialized) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const { uid, email } = decoded || {};

    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    /** Auto-promote configured admin emails even if user already existed. */
    try {
      const adminEmails = parseAdminEmails();
      const tokenEmail = String(email || "").trim().toLowerCase();
      const dbEmail = String(user.email || "").trim().toLowerCase();
      const effectiveEmail = tokenEmail || dbEmail;
      if (
        adminEmails.length &&
        effectiveEmail &&
        adminEmails.includes(effectiveEmail) &&
        user.role !== "admin"
      ) {
        user.role = "admin";
        await user.save();
      }
    } catch (_) {
      // best-effort; auth should not fail due to role promotion
    }

    req.user = user;
    req.firebase = { uid, email };

    console.log("[AUTH]", "Token verified");
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
}

module.exports = { verifyFirebaseToken };
