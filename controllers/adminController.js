const mongoose = require("mongoose");

const User = require("../models/User");
const Document = require("../models/Document");
const { cloudinary } = require("../config/cloudinary");
const { scheduleDocumentOcr } = require("../utils/scheduleDocumentOcr");
const { sanitizeAadhaarDocumentPlain } = require("../utils/sanitizeDocumentExtracted");

function escapeRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getAllUsers(req, res, next) {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = 10;
    const skip = (page - 1) * limit;

    const userMatch = {};
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      userMatch.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const statusAllowed = ["pending", "processing", "verified", "failed"];
    const statusFilter = statusAllowed.includes(status) ? status : null;

    const basePipeline = [
      { $match: userMatch },
      {
        $lookup: {
          from: "documents",
          localField: "_id",
          foreignField: "userId",
          as: "documents",
        },
      },
    ];

    if (statusFilter) {
      basePipeline.push({
        $match: {
          "documents.status": statusFilter,
        },
      });
    }

    const countPipeline = [...basePipeline, { $count: "totalCount" }];

    const dataPipeline = [
      ...basePipeline,
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          uid: 1,
          name: 1,
          email: 1,
          phone: 1,
          role: 1,
          createdAt: 1,
          documents: 1,
        },
      },
    ];

    const [countResult, users] = await Promise.all([
      User.aggregate(countPipeline),
      User.aggregate(dataPipeline),
    ]);

    const totalCount = countResult?.[0]?.totalCount || 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    const usersOut = (users || []).map((u) => ({
      ...u,
      documents: (u.documents || []).map((d) =>
        d?.type === "aadhaar" ? sanitizeAadhaarDocumentPlain(d) : d
      ),
    }));

    return res.status(200).json({
      success: true,
      data: { users: usersOut, totalCount, page, totalPages },
    });
  } catch (err) {
    return next(err);
  }
}

async function getUserById(req, res, next) {
  try {
    const userId = req.params.userId || req.params.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const documentsRaw = await Document.find({ userId: user._id }).sort({
      uploadedAt: -1,
    });
    const documents = documentsRaw.map((d) => {
      const plain = d.toObject?.() ?? d;
      return plain.type === "aadhaar"
        ? sanitizeAadhaarDocumentPlain(plain)
        : plain;
    });

    return res.status(200).json({
      success: true,
      data: { user, documents },
    });
  } catch (err) {
    return next(err);
  }
}

async function getDashboardStats(req, res, next) {
  try {
    const [
      totalUsers,
      totalDocuments,
      verifiedDocuments,
      failedDocuments,
      pendingDocuments,
    ] = await Promise.all([
      User.countDocuments({}),
      Document.countDocuments({}),
      Document.countDocuments({ status: "verified" }),
      Document.countDocuments({ status: "failed" }),
      Document.countDocuments({ status: { $in: ["pending", "processing"] } }),
    ]);

    const stats = {
      totalUsers,
      totalDocuments,
      verifiedDocuments,
      failedDocuments,
      pendingDocuments,
    };

    return res.status(200).json({ success: true, data: { stats } });
  } catch (err) {
    return next(err);
  }
}

async function deleteDocument(req, res, next) {
  try {
    const documentId = req.params.documentId || req.params.id;
    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid document id" });
    }

    const doc = await Document.findById(documentId);
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Document not found" });
    }

    if (doc.publicId) {
      try {
        await cloudinary.uploader.destroy(doc.publicId, {
          resource_type: "raw",
        });
      } catch (err) {
        console.warn(
          "[admin] Cloudinary delete failed:",
          doc.publicId,
          err?.message || err
        );
      }
    }

    await Document.deleteOne({ _id: documentId });

    return res.status(200).json({
      success: true,
      message: "Document and stored file deleted",
    });
  } catch (err) {
    return next(err);
  }
}

async function reprocessDocument(req, res, next) {
  try {
    const documentId = req.params.documentId || req.params.id;
    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid document id" });
    }

    const doc = await Document.findById(documentId);
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Document not found" });
    }
    if (!doc.fileUrl) {
      return res.status(400).json({
        success: false,
        message: "No file URL stored for this document",
      });
    }

    await Document.findByIdAndUpdate(documentId, {
      $set: {
        status: "processing",
        failureReason: null,
        extractedData: {},
        processedAt: null,
      },
    });

    scheduleDocumentOcr(doc._id, doc.fileUrl, doc.type);

    return res.status(200).json({
      success: true,
      message: "OCR reprocessing started",
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getAllUsers,
  getUserById,
  getDashboardStats,
  deleteDocument,
  reprocessDocument,
};
