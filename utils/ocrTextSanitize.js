/**
 * Post-OCR cleanup for blurry / noisy identity documents.
 */

function countMatches(re, str) {
  const m = str.match(re);
  return m ? m.length : 0;
}

function vowelRatioInLetters(line) {
  const letters = (line.match(/[A-Za-z]/g) || []).length;
  if (letters === 0) return 1;
  const vowels = (line.match(/[aeiou]/gi) || []).length;
  return vowels / letters;
}

function isGarbageOcrLine(line) {
  const t = line.trim();
  if (t.length < 3) return true;

  const lower = t.toLowerCase();

  // Never drop lines that are useful for ID parsing
  if (/\b\d{4}\s+\d{4}\s+\d{4}\b/.test(t)) return false;
  if (/\b\d{3}\s+\d{3}\b|\b\d{6}\b/.test(t)) return false;
  if (
    /\b(dob|date of birth|address|government|aadhaar|unique|vid|pin|pincode|district|male|female|state|rajasthan|india|authority|department|father|mother|\/o)\b/i.test(
      lower
    )
  )
    return false;
  if (/\d{2}[\/.\-]\d{2}[\/.\-]\d{4}/.test(t)) return false;
  if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(t)) return false;

  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  const weird = countMatches(/[^A-Za-z0-9\s,.\-\/:;()&]/g, t);

  if (letters + digits === 0) return true;
  if (weird / t.length > 0.22) return true;

  const vr = vowelRatioInLetters(t);
  if (letters >= 18 && vr < 0.12) return true;
  if (letters >= 30 && vr < 0.18) return true;

  // Single-char tokens with spaces (OCR snow)
  if (/^([A-Za-z0-9]\s){6,}/.test(t)) return true;

  return false;
}

function stripGarbageLines(text) {
  return String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isGarbageOcrLine(l))
    .join("\n");
}

/**
 * Merge two OCR passes: unique lines, stable order.
 */
function mergeOcrOutputs(a, b) {
  const seen = new Set();
  const out = [];
  for (const block of [a, b]) {
    for (const line of String(block || "")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)) {
      const key = line.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out.join("\n");
}

module.exports = {
  stripGarbageLines,
  mergeOcrOutputs,
  isGarbageOcrLine,
};
