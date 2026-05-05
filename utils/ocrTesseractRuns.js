const { createWorker, PSM } = require("tesseract.js");
const {
  preprocessIdCardPng,
  preprocessIdCardBlurFriendly,
} = require("./ocrImagePreprocess");

async function recognizeWithWorker(worker, imageBuffer, psm, rotateAuto = true) {
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: String(psm),
  });
  const { data } = await worker.recognize(imageBuffer, { rotateAuto });
  return data?.text || "";
}

/**
 * Run several strategies on raw + sharpened PNG and concatenate.
 * Uses one Tesseract worker for all passes — avoids reloading eng.traineddata / WASM per call.
 * Does NOT aggressively drop lines — that was wiping valid OCR on many PDFs.
 */
async function runMultiStrategyOcr(pngBuffer) {
  const sep = "\n<<<ocr_pass>>>\n";
  const blobs = [];
  const worker = await createWorker("eng");

  try {
    blobs.push(await recognizeWithWorker(worker, pngBuffer, PSM.AUTO, true));
    blobs.push(await recognizeWithWorker(worker, pngBuffer, PSM.SINGLE_BLOCK, true));

    if (process.env.OCR_SKIP_SHARP_PASS !== "1") {
      try {
        const sharpened = await preprocessIdCardPng(pngBuffer);
        blobs.push(await recognizeWithWorker(worker, sharpened, PSM.AUTO, true));
        blobs.push(
          await recognizeWithWorker(worker, sharpened, PSM.SPARSE_TEXT, true)
        );
      } catch (err) {
        console.warn("[OCR] preprocess skipped:", err?.message || err);
      }
    }

    if (process.env.OCR_SKIP_BLUR_PASS !== "1") {
      try {
        const blurTune = await preprocessIdCardBlurFriendly(pngBuffer);
        blobs.push(await recognizeWithWorker(worker, blurTune, PSM.AUTO, true));
        blobs.push(
          await recognizeWithWorker(worker, blurTune, PSM.SPARSE_TEXT, true)
        );
      } catch (err) {
        console.warn(
          "[OCR] blur-friendly preprocess skipped:",
          err?.message || err
        );
      }
    }
  } finally {
    await worker.terminate();
  }

  return blobs.filter((b) => b && String(b).trim().length > 0).join(sep);
}

module.exports = { runMultiStrategyOcr };
