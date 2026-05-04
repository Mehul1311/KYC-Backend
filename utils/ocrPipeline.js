const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { randomUUID } = require("crypto");

const {
  extractAadhaarNumber,
  extractPanNumber,
  extractDOB,
  extractAddress,
  extractName,
  expandOcrStructuralNewlines,
} = require("./regexExtractors");
const { runMultiStrategyOcr } = require("./ocrTesseractRuns");

function cleanText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Download via built-in fetch (Node 18+): follows redirects, handles relative Locations
 * reliably (manual https.get often breaks on Cloudinary / CDN redirects).
 */
async function downloadUrlToPdfFile(url, destPath) {
  const controller = new AbortController();
  const ttl = Number(process.env.OCR_DOWNLOAD_TIMEOUT_MS || 45000);
  const timer = setTimeout(() => controller.abort(), ttl);

  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/pdf,application/octet-stream,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; KYC-OCR/1.0; +backend)",
      },
    });
  } catch (err) {
    throw new Error(`Could not download document URL: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Failed to download PDF (HTTP ${res.status})`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8) {
    throw new Error("Downloaded file is empty or truncated");
  }
  const magic = buf.subarray(0, 5).toString("latin1");
  if (!magic.startsWith("%PDF")) {
    throw new Error(
      "Downloaded bytes are not a PDF. Re-upload from Dashboard or confirm the file stored in Cloudinary is a PDF."
    );
  }

  await fs.promises.writeFile(destPath, buf);
  return destPath;
}

async function safeUnlink(p) {
  if (!p) return;
  try {
    await fs.promises.unlink(p);
  } catch (_) {
    // ignore cleanup errors
  }
}

/**
 * Renders page 1 of a PDF to PNG using pdf.js + @napi-rs/canvas.
 * ~420 DPI for better Tesseract read on small ID cards.
 */
async function renderPdfFirstPageToPng(pdfPath, pngPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const workerFile = path.join(
    __dirname,
    "..",
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.min.mjs"
  );
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerFile).href;
  }

  const buf = await fs.promises.readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    verbosity: 0,
    useSystemFonts: true,
    disableFontFace: false,
  });
  let pdfDoc;
  try {
    pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);
    const scale = 420 / 72;
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    await page.render({
      canvasContext: ctx,
      viewport,
      background: "#ffffff",
    }).promise;
    const pngBuffer = await canvas.encode("png");
    await fs.promises.writeFile(pngPath, pngBuffer);
  } finally {
    try {
      await loadingTask.destroy();
    } catch (_) {
      // ignore
    }
  }
}

async function processDocument(fileUrl, documentType) {
  console.log("[OCR]", `Starting for type: ${documentType}`);

  const tmpDir = os.tmpdir(); // cross-platform "tmp" directory
  const id = randomUUID();
  const pdfPath = path.join(tmpDir, `kyc_${documentType}_${id}.pdf`);
  let pngPath = null;

  try {
    // Step 1: Download PDF to temp (fetch follows redirects)

    console.log(
      "[OCR] Downloading PDF from Cloudinary/host…",
      String(fileUrl).replace(/\?.*$/, "?…")
    );
    await downloadUrlToPdfFile(fileUrl, pdfPath);

    // Step 2: Convert first page to PNG (300 DPI) to temp
    pngPath = path.join(tmpDir, `kyc_${documentType}_${id}.png`);
    await renderPdfFirstPageToPng(pdfPath, pngPath);

    const pngBuffer = await fs.promises.readFile(pngPath);
    const rawText = await runMultiStrategyOcr(pngBuffer);

    if (!String(rawText || "").trim()) {
      throw new Error("OCR produced no text — check that the PDF is selectable or a clear scan");
    }

    const snippet = String(rawText).replace(/\s+/g, " ").trim().slice(0, 520);
    console.log("[OCR] Text snippet:", snippet, rawText.length > 520 ? "…" : "");

    let text = expandOcrStructuralNewlines(cleanText(rawText));
    text = cleanText(text);

    // Step 6: Extract fields
    let extractedData = {};
    if (documentType === "aadhaar") {
      const aadhaarNumber = extractAadhaarNumber(text);
      const dob = extractDOB(text);
      const addr = extractAddress(text);
      const address = {
        city: addr?.city ?? null,
        state: addr?.state ?? null,
        pincode: addr?.pincode ?? null,
      };

      /** Name comes from PAN only — Aadhaar stores number, DOB, address. */
      extractedData = { aadhaarNumber, dob, address };
    } else if (documentType === "pan") {
      const panNumber = extractPanNumber(text);
      const fullName = extractName(text);
      const dob = extractDOB(text);

      extractedData = { panNumber, fullName, dob };
    } else {
      throw new Error(`Unsupported documentType: ${documentType}`);
    }

    // Step 8: Return extracted data
    const fieldsFound = Object.entries(extractedData)
      .flatMap(([k, v]) => {
        if (v == null) return [];
        if (typeof v === "object") {
          const sub = Object.entries(v)
            .filter(([, sv]) => sv != null && String(sv).trim() !== "")
            .map(([sk]) => `${k}.${sk}`);
          return sub.length ? [k, ...sub] : [k];
        }
        if (String(v).trim() === "") return [];
        return [k];
      })
      .filter((v, i, a) => a.indexOf(v) === i);

    console.log("[OCR]", `Completed, fields found: ${fieldsFound.join(", ") || "none"}`);

    return extractedData;
  } catch (err) {
    console.error(
      "[OCR] Pipeline error:",
      err?.stack || err?.message || String(err)
    );
    throw new Error(err?.message || "OCR processing failed");
  } finally {
    // Step 7: Cleanup temp files
    await safeUnlink(pngPath);
    await safeUnlink(pdfPath);
  }
}

module.exports = { processDocument };
