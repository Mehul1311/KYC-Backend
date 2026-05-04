const Document = require("../models/Document");
const { cloudinary } = require("../config/cloudinary");
const { scheduleDocumentOcr } = require("../utils/scheduleDocumentOcr");
const { sanitizeAadhaarDocumentPlain } = require("../utils/sanitizeDocumentExtracted");

async function uploadDocument(req, res, next) {
  try {
    const type = String(req.query.type || "").toLowerCase();
    if (!["aadhaar", "pan"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid document type" });
    }

    const fileUrl = req?.file?.path;
    const publicId = req?.file?.filename;
    if (!fileUrl || !publicId) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    console.log("[UPLOAD]", `File uploaded by userId: ${req.user?._id}`);

    const existing = await Document.findOne({ userId: req.user._id, type });
    if (existing?.publicId) {
      try {
        await cloudinary.uploader.destroy(existing.publicId, {
          resource_type: "raw",
        });
      } catch (_) {
        // best-effort delete; do not block upload
      }
    }

    const document = await Document.findOneAndUpdate(
      { userId: req.user._id, type },
      {
        $set: {
          userId: req.user._id,
          type,
          fileUrl,
          publicId,
          status: "processing",
          failureReason: null,
          extractedData: {},
          processedAt: null,
          uploadedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    res.status(200).json({
      success: true,
      data: { document },
      message: "Upload successful, processing started",
    });

    scheduleDocumentOcr(document._id, fileUrl, type);
  } catch (err) {
    return next(err);
  }
}

async function getMyDocuments(req, res, next) {
  try {
    const q = Document.find({ userId: req.user._id }).sort({
      uploadedAt: -1,
    });
    // Regular users must not receive extracted fields; admins may (own dashboard OCR view).
    if (req.user?.role !== "admin") {
      q.select("-extractedData");
    }
    let documents = await q;
    documents = documents.map((d) =>
      d?.type === "aadhaar"
        ? sanitizeAadhaarDocumentPlain(d.toObject?.() ?? d)
        : d.toObject?.() ?? d
    );
    return res.status(200).json({ success: true, data: { documents } });
  } catch (err) {
    return next(err);
  }
}

async function retryMyDocumentOcr(req, res, next) {
  try {
    const type = String(req.query.type || "").toLowerCase();
    if (!["aadhaar", "pan"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid document type" });
    }

    const doc = await Document.findOne({ userId: req.user._id, type });
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "No document found for this type" });
    }
    if (!doc.fileUrl) {
      return res.status(400).json({
        success: false,
        message: "No file on record — upload a PDF first",
      });
    }

    await Document.findByIdAndUpdate(doc._id, {
      $set: {
        status: "processing",
        failureReason: null,
        extractedData: {},
        processedAt: null,
      },
    });

    scheduleDocumentOcr(doc._id, doc.fileUrl, type);

    return res.status(200).json({
      success: true,
      message: "OCR reprocessing started",
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { uploadDocument, getMyDocuments, retryMyDocumentOcr };
