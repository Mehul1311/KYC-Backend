const sharp = require("sharp");

/**
 * Mild sharpen + upscale — avoids crushing contrast (which blanked OCR on many PDFs).
 * Set OCR_SHARP_AGGRESSIVE=1 in env for heavier processing.
 */
async function preprocessIdCardPng(inputBuffer) {
  const aggressive = process.env.OCR_SHARP_AGGRESSIVE === "1";
  const meta = await sharp(inputBuffer).metadata();
  const w = meta.width || 1600;

  let pipeline = sharp(inputBuffer);

  const targetWidth = aggressive ? 2800 : 2400;
  if (w < targetWidth - 80) {
    pipeline = pipeline.resize({
      width: targetWidth,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    });
  }

  if (aggressive) {
    return pipeline
      .greyscale()
      .normalize({ lower: 2, upper: 98 })
      .linear(1.22, -(0.08 * 255))
      .sharpen({ sigma: 1.8, m1: 0.85, m2: 3, x1: 2, y2: 10 })
      .png({ compressionLevel: 6 })
      .toBuffer();
  }

  return pipeline
    .greyscale()
    .normalize({ lower: 4, upper: 96 })
    .linear(1.1, -(0.03 * 255))
    .sharpen({ sigma: 1.1, m1: 1, m2: 2 })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Blur-tolerant pipeline: enlarge, gentle blur to kill speckles, strong unsharp, stretch contrast.
 * Used as an extra OCR pass (env OCR_SKIP_BLUR_PASS=1 to disable).
 */
async function preprocessIdCardBlurFriendly(inputBuffer) {
  const meta = await sharp(inputBuffer).metadata();
  let pipeline = sharp(inputBuffer);
  const w = meta.width || 1600;

  const targetWidth = Math.max(w < 2600 ? 3000 : 2800, 2600);
  if (w < targetWidth - 60) {
    pipeline = pipeline.resize({
      width: targetWidth,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    });
  }

  return pipeline
    .greyscale()
    .normalize({ lower: 1, upper: 99 })
    .modulate({ brightness: 1.05 })
    .blur(0.45)
    .sharpen({ sigma: 2.5, m1: 0.95, m2: 4, x1: 3, y2: 16 })
    .linear(1.18, -(0.05 * 255))
    .normalize({ lower: 2, upper: 98 })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

module.exports = { preprocessIdCardPng, preprocessIdCardBlurFriendly };
