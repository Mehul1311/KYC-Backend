const express = require("express");

const { verifyFirebaseToken } = require("../middleware/verifyFirebaseToken");
const { isAdmin } = require("../middleware/isAdmin");
const {
  getAllUsers,
  getUserById,
  getDashboardStats,
  deleteDocument,
  reprocessDocument,
} = require("../controllers/adminController");

const router = express.Router();

router.use(verifyFirebaseToken);
router.use(isAdmin);

router.get("/users", getAllUsers);
router.get("/users/:userId", getUserById);
router.get("/stats", getDashboardStats);
router.delete("/documents/:documentId", deleteDocument);
router.post("/documents/:documentId/reprocess", reprocessDocument);

module.exports = router;
