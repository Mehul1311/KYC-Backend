const express = require("express");
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");

const { syncUser, getMe } = require("../controllers/authController");
const { verifyFirebaseToken } = require("../middleware/verifyFirebaseToken");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authLimiter);

router.post(
  "/sync",
  [
    body("name").notEmpty().withMessage("name is required"),
    body("uid").notEmpty().withMessage("uid is required"),
    body("email")
      .optional({ values: "falsy" })
      .isEmail()
      .withMessage("valid email is required when provided"),
    body("phone")
      .optional({ values: "falsy" })
      .matches(/^\+[1-9]\d{6,14}$/)
      .withMessage("phone must be E.164 (e.g. +919876543210)"),
    body().custom((_, { req }) => {
      const e = String(req.body?.email || "").trim();
      const p = String(req.body?.phone || "").trim();
      if (!e && !p) {
        throw new Error("Either email or phone is required");
      }
      return true;
    }),
  ],
  syncUser
);

router.get("/me", verifyFirebaseToken, getMe);

module.exports = router;
