const { createWorker, PSM } = require("tesseract.js");
const {
  preprocessIdCardPng,
  preprocessIdCardBlurFriendly,
} = require("./ocrImagePreprocess");

/**
 * One worker lifecycle = one recognise (avoids stale image / PSM quirks between runs).
 */
async function recognizeOnce(imageBuffer, psm, rotateAuto = true) {
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: String(psm),
    });
    const { data } = await worker.recognize(imageBuffer, { rotateAuto });
    return data?.text || "";
  } finally {
    await worker.terminate();
  }
}

/**
 * Run several strategies on raw + sharpened PNG and concatenate.
 * Does NOT aggressively drop lines — that was wiping valid OCR on many PDFs.
 */
async function runMultiStrategyOcr(pngBuffer) {
  const sep = "\n<<<ocr_pass>>>\n";
  const blobs = [];

  blobs.push(await recognizeOnce(pngBuffer, PSM.AUTO, true));
  blobs.push(await recognizeOnce(pngBuffer, PSM.SINGLE_BLOCK, true));

  if (process.env.OCR_SKIP_SHARP_PASS !== "1") {
    try {
      const sharpened = await preprocessIdCardPng(pngBuffer);
      blobs.push(await recognizeOnce(sharpened, PSM.AUTO, true));
      blobs.push(await recognizeOnce(sharpened, PSM.SPARSE_TEXT, true));
    } catch (err) {
      console.warn("[OCR] preprocess skipped:", err?.message || err);
    }
  }

  if (process.env.OCR_SKIP_BLUR_PASS !== "1") {
    try {
      const blurTune = await preprocessIdCardBlurFriendly(pngBuffer);
      blobs.push(await recognizeOnce(blurTune, PSM.AUTO, true));
      blobs.push(await recognizeOnce(blurTune, PSM.SPARSE_TEXT, true));
    } catch (err) {
      console.warn("[OCR] blur-friendly preprocess skipped:", err?.message || err);
    }
  }

  return blobs.filter((b) => b && String(b).trim().length > 0).join(sep);
}

module.exports = { runMultiStrategyOcr };
