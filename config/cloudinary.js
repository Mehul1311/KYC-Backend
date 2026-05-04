const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

function assertCloudinaryEnv() {
  const {
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
  } = process.env;

  const missing = [
    !CLOUDINARY_CLOUD_NAME && "CLOUDINARY_CLOUD_NAME",
    !CLOUDINARY_API_KEY && "CLOUDINARY_API_KEY",
    !CLOUDINARY_API_SECRET && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Missing Cloudinary env vars: ${missing.join(
        ", "
      )}. Copy backend/.env.example and set all CLOUDINARY_* keys.`
    );
  }

  const bad = /\s/.test(String(CLOUDINARY_CLOUD_NAME));
  if (bad) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME must be a single word (no spaces). Copy it from Cloudinary dashboard."
    );
  }
}

assertCloudinaryEnv();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async () => {
    return {
      folder: "kyc-documents",
      resource_type: "raw",
    };
  },
});

function pdfOnlyFileFilter(req, file, cb) {
  if (file?.mimetype === "application/pdf") return cb(null, true);
  return cb(new Error("Only PDF files are allowed"));
}

const upload = multer({
  storage,
  fileFilter: pdfOnlyFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = { cloudinary, upload };
