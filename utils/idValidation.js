/**
 * Verhoeff checksum (UIDAI Aadhaar). PAN helpers (structure + OCR repair only —
 * PAN check-letter algorithm is not publicly documented by ITD).
 */

const VERHOEFF_TABLE_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_TABLE_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffChecksumDigit(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (!d.length) return null;
  let c = 0;
  let j = 0;
  for (let i = d.length - 1; i >= 0; i -= 1, j += 1) {
    const di = Number(d[i]);
    if (Number.isNaN(di)) return null;
    c = VERHOEFF_TABLE_D[c][VERHOEFF_TABLE_P[j % 8][di]];
  }
  return c;
}

function verhoeffValid12(digits12) {
  const d = String(digits12 || "").replace(/\D/g, "");
  if (d.length !== 12) return false;
  return verhoeffChecksumDigit(d) === 0;
}

/** PAN fourth character indicates entity category (sample set from common PAN cards). */
const PAN_ENTITY_CHARS = new Set(["P", "C", "H", "F", "A", "T", "B", "L", "J", "G"]);

function panFormatAndEntityOk(pan10) {
  const p = String(pan10 || "").toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p)) return false;
  return PAN_ENTITY_CHARS.has(p[3]);
}

/** Levenshtein distance for fuzzy state matching */
function levenshtein(a, b) {
  const m = String(a || "").length;
  const n = String(b || "").length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, (_, j) => j)
  );
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  const A = String(a);
  const B = String(b);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Expand middle 4 digits for common OCR confusions (letters read as digits and vice versa).
 */
function* panDigitOcrVariants(pan10) {
  const p = String(pan10 || "").toUpperCase();
  if (p.length !== 10) return;
  yield p;

  const prefix = p.slice(0, 5);
  const mid = p.slice(5, 9).split("");
  const tail = p.slice(9);

  const digitConfusions = {
    O: "0",
    D: "0",
    Q: "0",
    I: "1",
    L: "1",
    l: "1",
    Z: "2",
    S: "5",
    B: "8",
    G: "6",
  };

  for (let i = 0; i < 4; i += 1) {
    const ch = mid[i];
    const rep = digitConfusions[ch];
    if (rep) {
      const copy = [...mid];
      copy[i] = rep;
      yield `${prefix}${copy.join("")}${tail}`;
    }
  }
}

function pickBestAadhaar12(candidates) {
  const ordered = (candidates || [])
    .map((c) => String(c).replace(/\D/g, ""))
    .filter((d) => d.length === 12);
  if (!ordered.length) return null;
  for (const d of ordered) {
    if (verhoeffValid12(d)) return d;
  }
  const seen = new Set();
  for (const d of ordered) {
    if (!seen.has(d)) {
      seen.add(d);
      return d;
    }
  }
  return ordered[ordered.length - 1];
}

module.exports = {
  verhoeffValid12,
  verhoeffChecksumDigit,
  panFormatAndEntityOk,
  levenshtein,
  panDigitOcrVariants,
  pickBestAadhaar12,
};
