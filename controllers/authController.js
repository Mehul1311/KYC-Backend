const { validationResult } = require("express-validator");
const User = require("../models/User");

async function syncUser(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: errors.array(),
      });
    }

    const { name, uid } = req.body;
    const email = String(req.body?.email || "").trim().toLowerCase() || undefined;
    const phone = String(req.body?.phone || "").trim() || undefined;

    const baseUpdate = { name };
    if (email) baseUpdate.email = email;
    if (phone) baseUpdate.phone = phone;

    const setOnInsert = { role: "user" };

    const user = await User.findOneAndUpdate(
      { uid },
      { $set: baseUpdate, $setOnInsert: setOnInsert },
      { upsert: true, returnDocument: "after" }
    );

    const adminEmails = String(process.env.ADMIN_EMAIL || "")
      .split(/[,\s]+/g)
      .map((s) => String(s || "").trim().toLowerCase())
      .filter(Boolean);
    const userEmail = email || "";
    if (
      adminEmails.length &&
      userEmail &&
      adminEmails.includes(userEmail) &&
      user.role !== "admin"
    ) {
      user.role = "admin";
      await user.save();
    }

    console.log("[AUTH]", `User synced: ${email || phone || uid}`);
    return res
      .status(200)
      .json({ success: true, data: { user }, message: "User synced" });
  } catch (err) {
    return next(err);
  }
}

async function getMe(req, res) {
  return res.status(200).json({ success: true, data: { user: req.user } });
}

module.exports = { syncUser, getMe };
