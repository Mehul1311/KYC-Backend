require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { connectDB } = require("./config/db");
const { errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const documentRoutes = require("./routes/documentRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

app.use(helmet());
app.use(
  morgan("method=:method url=:url status=:status ms=:response-time", {
    stream: {
      write: (message) => console.log("[HTTP]", message.trim()),
    },
  })
);

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;

  // Dev ergonomics: Vite sometimes shifts ports (5173 -> 5174) if one is busy.
  if (process.env.NODE_ENV !== "production") {
    try {
      const u = new URL(origin);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    } catch (_) {
      return false;
    }
  }

  const envOriginsRaw =
    process.env.CLIENT_URLS ||
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_ORIGIN ||
    "";
  const envOrigins = String(envOriginsRaw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allow = new Set([
    ...envOrigins,
    "http://localhost:5173",
    "http://localhost:5174",
  ]);
  return allow.has(origin);
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (isAllowedCorsOrigin(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "kyc-backend",
    status: "ok",
    health: "/health",
    apis: ["/api/auth", "/api/documents", "/api/admin"],
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date(),
    ocr: "pdfjs+napi-canvas+tesseract",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    method: req.method,
    path: req.originalUrl,
  });
});

app.use(errorHandler);

async function start() {
  const port = Number(process.env.PORT || 5000);

  try {
    await connectDB();
    console.log("[SERVER]", `MongoDB connected`);

    try {
      const Document = require("./models/Document");
      const r = await Document.updateMany(
        { type: "aadhaar", "extractedData.fullName": { $exists: true } },
        { $unset: { "extractedData.fullName": "" } },
      );
      if (r.modifiedCount > 0) {
        console.log(
          "[SERVER]",
          `Removed legacy Aadhaar fullName from ${r.modifiedCount} document(s)`,
        );
      }
    } catch (e) {
      console.warn("[SERVER]", "Legacy fullName cleanup skipped:", e?.message || e);
    }

    app.listen(port, () => {
      console.log("[SERVER]", `Listening on port ${port}`);
      console.log(
        "[OCR]",
        "pdf.js + @napi-rs/canvas + tesseract.js (GraphicsMagick / ImageMagick not required)"
      );
    });
  } catch (err) {
    console.error("[SERVER]", "Failed to start server");
    console.error("[SERVER]", err);
    process.exitCode = 1;
  }
}

start();
