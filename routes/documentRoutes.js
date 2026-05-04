const express = require("express");

const { verifyFirebaseToken } = require("../middleware/verifyFirebaseToken");
const { upload } = require("../config/cloudinary");
const {
  uploadDocument,
  getMyDocuments,
  retryMyDocumentOcr,
} = require("../controllers/documentController");

const router = express.Router();

router.post(
  "/upload",
  verifyFirebaseToken,
  upload.single("document"),
  uploadDocument
);

router.get("/my-documents", verifyFirebaseToken, getMyDocuments);
router.post("/retry-ocr", verifyFirebaseToken, retryMyDocumentOcr);

module.exports = router;
