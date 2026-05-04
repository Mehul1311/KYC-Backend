const {
  panFormatAndEntityOk,
  panDigitOcrVariants,
  pickBestAadhaar12,
  verhoeffValid12,
  levenshtein,
} = require("./idValidation");

/** Devanagari card keywords as escapes (Latin-only source; matches bilingual Aadhaar/PAN OCR). */
const D_NAME = "\u0928\u093e\u092e";
const D_AADHAAR = "\u0906\u0927\u093e\u0930";

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim();
}

function toLines(text) {
  return normalizeText(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Help parsers when Tesseract returns one long line or missing line breaks */
function expandOcrStructuralNewlines(text) {
  let t = String(text || "").replace(/\r/g, "\n");
  t = t.replace(/\b(\d{4})([\s\-–—\._]+)(\d{4})([\s\-–—\._]+)(\d{4})\b/g, "\n$1 $3 $5\n");
  t = t.replace(/\b([A-Z]{5})(\d{4})([A-Z])\b/g, "\n$1$2$3\n");
  const labels =
    new RegExp(
      `\\b(?:Government of India|Unique Identification|Father'?s\\s+Name|Mother'?s\\s+Name|Name|${D_NAME}|Address|Date of Birth|DOB|Gender|Male|Female|Pincode|PIN|District|STATE|VID|Aadhaar|${D_AADHAAR})\\b`,
      "gi"
    );
  t = t.replace(labels, "\n$&");
  t = t.replace(/\n{4,}/g, "\n\n\n");
  return t.trim();
}

/** OCR often splits pin as 123 456 */
function extractPincodeFromString(s) {
  if (!s) return null;
  const t = String(s);
  const six = t.match(/\b(\d{6})\b/);
  if (six) return six[1];
  const spaced = t.match(/\b(\d{3})\s+(\d{3})\b/);
  if (spaced) return `${spaced[1]}${spaced[2]}`;
  return null;
}

// Longer names first so "Dadra and Nagar Haveli" matches before "Dadra"
const INDIAN_STATES_AND_UT = [
  "Andaman and Nicobar Islands",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Dadra and Nagar Haveli",
  "Daman and Diu",
  "Jammu and Kashmir",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Himachal Pradesh",
  "Madhya Pradesh",
  "Uttar Pradesh",
  "West Bengal",
  "Uttarakhand",
  "Chhattisgarh",
  "Maharashtra",
  "Meghalaya",
  "Manipur",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Orissa",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Telangana",
  "Tamil Nadu",
  "Tripura",
  "Karnataka",
  "Gujarat",
  "Haryana",
  "Assam",
  "Bihar",
  "Goa",
  "Delhi",
  "Kerala",
  "Jharkhand",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
  "Chandigarh",
];

function findStateInText(text) {
  const upper = text.toUpperCase().replace(/\s+/g, " ");
  for (const state of INDIAN_STATES_AND_UT) {
    const needle = state.toUpperCase();
    if (upper.includes(needle)) return state;
  }
  return null;
}

/** Fuzzy state match on tail of address blob (blurty OCR on long state names). */
function minLevenshteinToAnyWindow(hayCompact, needle) {
  const h = String(hayCompact || "").toUpperCase();
  const n = String(needle || "").toUpperCase();
  const nl = n.length;
  if (nl < 4 || h.length < 4) return Infinity;
  let best = Infinity;
  const lo = Math.max(4, nl - 3);
  const hi = nl + 4;
  for (let L = lo; L <= hi; L += 1) {
    for (let i = 0; i + L <= h.length; i += 1) {
      const sub = h.slice(i, i + L);
      const d = levenshtein(sub, n);
      if (d < best) best = d;
    }
  }
  return best;
}

function fuzzyFindStateInText(text) {
  const exact = findStateInText(text);
  if (exact) return exact;
  const norm = normalizeText(text).slice(-240).replace(/\s+/g, "");
  if (norm.length < 5) return null;

  let bestState = null;
  let bestDist = Infinity;
  for (const state of INDIAN_STATES_AND_UT) {
    const needle = state.replace(/\s+/g, "");
    const d = minLevenshteinToAnyWindow(norm, needle);
    const thr = Math.max(2, Math.floor(needle.length / 5));
    if (d <= thr && d < bestDist) {
      bestDist = d;
      bestState = state;
    }
  }
  return bestState;
}

function stripPinFromLine(line) {
  return String(line || "")
    .replace(/\b\d{3}\s+\d{3}\b/g, "")
    .replace(/\b\d{6}\b/g, "")
    .replace(/\b(pin|pincode|postal)\b[:\-]?\s*/gi, "")
    .replace(/[,;]\s*$/g, "")
    .trim();
}

/** Drop leading OCR garbage before recognizable address cues */
function clipLeadingAddressNoise(blob) {
  if (!blob) return null;
  const s = String(blob);
  const cues = [
    /S\s*\/\s*O\b/i,
    /\bC\s*\/\s*O\b/i,
    /\b(?:house|flat|plot|door|ward|survey|survey\s*no|khasra|gat|gat\s*no)\b[^A-Za-z0-9]?/i,
    /\d{1,3}\s*[\/\\\-]\s*\d{1,4}\b/,
    /\d{6}\b/,
  ];
  let earliest = -1;
  for (const re of cues) {
    const m = re.exec(s);
    if (m && (earliest < 0 || m.index < earliest)) earliest = m.index;
  }
  let out =
    earliest > 35 && earliest < s.length ? s.slice(earliest).trim() : s;
  out = out.replace(/\s{2,}/g, " ");
  return out.length ? out : s.trim();
}

const KNOWN_CITY_TOKENS = [
  /\bJaipur\b/i,
  /\bJodhpur\b/i,
  /\bUdaipur\b/i,
  /\bKota\b/i,
  /\bAjmer\b/i,
  /\bBikaner\b/i,
  /\bDelhi\b/i,
  /\bGurgaon\b/i,
  /\bGurugram\b/i,
  /\bNoida\b/i,
  /\bMumbai\b/i,
  /\bPune\b/i,
  /\bBangalore\b/i,
  /\bBengaluru\b/i,
  /\bHyderabad\b/i,
  /\bChennai\b/i,
  /\bKolkata\b/i,
  /\bMansarovar\b/i,
  /\bMalviya\s*Nagar\b/i,
  /\bVaishali\s*Nagar\b/i,
];

function titleCaseWords(s) {
  return String(s || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.slice(0, 1) + w.slice(1).toLowerCase())
    .join(" ");
}

function dedupeAdjacentTokens(city) {
  const parts = String(city || "")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (
      i > 0 &&
      parts[i].toUpperCase() === parts[i - 1].toUpperCase()
    ) {
      continue;
    }
    out.push(parts[i]);
  }
  return out.join(" ");
}

function salvageCityFromBlob(addrBlob, currentCity) {
  const bad =
    !currentCity ||
    currentCity.length < 4 ||
    vowelRatioLetters(currentCity) < 0.14 ||
    /\d/.test(currentCity);
  if (!bad) return currentCity;

  for (const re of KNOWN_CITY_TOKENS) {
    const m = addrBlob.match(re);
    if (m) return titleCaseWords(m[0].replace(/\s+/g, " "));
  }
  return currentCity;
}

function pinPrefixCityHint(pin, stateName) {
  if (!pin || pin.length !== 6) return null;
  if (pin.startsWith("302") && stateName === "Rajasthan") return "Jaipur";
  if (pin.startsWith("110") && stateName === "Delhi") return "Delhi";
  return null;
}

function formatAadhaarDigits(digits12) {
  if (!digits12 || String(digits12).length !== 12) return null;
  const d = String(digits12);
  return `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8, 12)}`;
}

function collectAadhaar12Candidates(text) {
  const t = normalizeText(text).replace(/\b([Oo])(?=\d)/gi, "0");
  const candidates = [];

  const flex = t.match(
    /\b(\d{4})\s*[\s\-–—\._]+\s*(\d{4})\s*[\s\-–—\._]+\s*(\d{4})\b/
  );
  if (flex) candidates.push(`${flex[1]}${flex[2]}${flex[3]}`);

  const spaced = t.match(/\b(\d{4})\s+(\d{4})\s+(\d{4})\b/);
  if (spaced) candidates.push(`${spaced[1]}${spaced[2]}${spaced[3]}`);

  const consecutive = t.match(/\b(\d{12})\b/);
  if (consecutive) candidates.push(consecutive[1]);

  for (const line of toLines(t)) {
    const digits = line.replace(/\D/g, "");
    if (digits.length === 12) candidates.push(digits);
    if (digits.length > 12) {
      for (let i = 0; i <= digits.length - 12; i++) {
        candidates.push(digits.slice(i, i + 12));
      }
    }
  }

  const flat = t.replace(/\D/g, "");
  if (flat.length >= 12) {
    for (let i = 0; i <= flat.length - 12; i++) {
      const chunk = flat.slice(i, i + 12);
      if (/^\d{12}$/.test(chunk)) candidates.push(chunk);
    }
  }

  return candidates;
}

function extractAadhaarNumber(text) {
  // Try raw + digit-normalized OCR (O->0, I/L->1, etc.) then validate via Verhoeff.
  const raw = String(text || "");
  const normalized = raw
    .replace(/[OoDdQq]/g, "0")
    .replace(/[IiLl]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Gg]/g, "6")
    .replace(/[Bb]/g, "8");

  const all = [
    ...collectAadhaar12Candidates(raw),
    ...collectAadhaar12Candidates(normalized),
  ]
    .map((c) => String(c || "").replace(/\D/g, ""))
    .filter((d) => d.length === 12);

  if (!all.length) return null;

  const valid = all.find((d) => verhoeffValid12(d));
  if (valid) return formatAadhaarDigits(valid);

  // Fallback (best-effort) when checksum can't be satisfied by OCR output.
  const best = pickBestAadhaar12(all);
  return best ? formatAadhaarDigits(best) : null;
}

function extractPanNumber(text) {
  const u = normalizeText(text).toUpperCase();
  const hits = [];

  const add = (s) => {
    const raw = String(s || "").trim();
    if (raw.length === 10) hits.push(raw.replace(/\s+/g, ""));
  };

  let m = u.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  if (m) add(m[1]);
  m = u.match(/\b([A-Z]{5})\s+(\d{4})\s+([A-Z])\b/);
  if (m) add(`${m[1]}${m[2]}${m[3]}`);

  const loosen = String(u.replace(/[`'""]/g, "")).replace(/[\t]+/g, " ");
  const compact = loosen.replace(/\s+/g, "");
  const globRx = /[A-Z]{5}[A-Z0-9OIZSLQDGB]{4}[A-Z]/g;
  let g;
  while ((g = globRx.exec(compact))) add(g[0]);

  for (const line of toLines(loosen)) {
    const row = line.replace(/\s+/g, "");
    const mm = row.match(/[A-Z]{5}[A-Z0-9]{4}[A-Z]/g);
    if (mm) mm.forEach((x) => add(x));
  }

  const uniq = [...new Set(hits)];

  function scorePan(pan10) {
    const p = String(pan10 || "").toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p)) return -1;
    let score = 2;
    if (panFormatAndEntityOk(p)) score += 5; // strong signal
    // If seen near explicit PAN label, boost
    if (/\b(PAN|Permanent Account Number)\b/i.test(text)) score += 1;
    return score;
  }

  let best = null;
  let bestScore = -1;

  for (const cand of uniq) {
    for (const v of panDigitOcrVariants(cand)) {
      const s = scorePan(v);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
  }

  if (best) return best;

  // Very last resort: accept strict regex match even if entity-char check fails,
  // because OCR commonly corrupts the 4th character.
  const strict = /\b([A-Z]{5}\d{4}[A-Z])\b/.exec(u);
  if (strict) return strict[1];
  const compact2 = u.replace(/\s+/g, "").match(/([A-Z]{5}\d{4}[A-Z])/);
  if (compact2) return compact2[1];

  return null;
}

function vowelRatioLetters(s) {
  const letters = (String(s).match(/[A-Za-z]/g) || []).length;
  if (!letters) return 1;
  return (String(s).match(/[aeiou]/gi) || []).length / letters;
}

function extractDOB(text) {
  const tPre = normalizeText(text)
    .replace(/(\d)\s*([\/.\-])\s*(\d)/g, "$1$2$3")
    .replace(/\b([Oo])(?=\d)/gi, "0");
  const t = tPre.replace(/([Oo])(?=[\/.\-])/g, "0");

  function normalizeDobMatch(raw) {
    const norm = String(raw || "").replace(/\s+/g, "");
    const m = norm.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (!m) return null;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy))
      return null;
    if (yyyy < 1900 || yyyy > new Date().getFullYear()) return null;
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;
    // Basic month/day sanity
    const maxDay = new Date(yyyy, mm, 0).getDate();
    if (dd > maxDay) return null;
    return `${dd}/${mm}/${yyyy}`;
  }

  const nearLabel = t.match(
    /\b(?:dob|date of birth|birth\s*date|year of birth)\b[^A-Za-z0-9]{0,45}(\d{1,2}\s*[\/.\-]+\s*\d{1,2}\s*[\/.\-]+\s*\d{4})\b/i
  );
  if (nearLabel) {
    const out = normalizeDobMatch(nearLabel[1]);
    if (out) return out;
  }

  const plain = t.match(/\b(\d{1,2}\s*[\/.\-]+\s*\d{1,2}\s*[\/.\-]+\s*\d{4})\b/);
  if (plain) {
    const out = normalizeDobMatch(plain[1]);
    if (out) return out;
  }

  return null;
}

function extractAddress(text) {
  let blob = normalizeText(text);
  if (blob.split("\n").length < 5) {
    blob = blob.replace(/([,;])\s+/g, "$1\n").replace(/\s+([,;])/g, "$1\n");
  }
  const lines = toLines(blob);
  const joined = lines.join("\n");

  const keywordRe =
    /\b(Address|House|Near|Village|Post|Dist|District|State|PIN|Pincode|Care\s*of|C\/O|S\/O|W\/O)\b/i;

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^address\b/i.test(lines[i]) || /\baddress\b/i.test(lines[i])) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (keywordRe.test(lines[i])) {
        startIdx = i;
        break;
      }
    }
  }

  // No label: look for a 6-digit pin and treat previous lines as address
  if (startIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (extractPincodeFromString(lines[i])) {
        startIdx = Math.max(0, i - 4);
        break;
      }
    }
  }

  if (startIdx === -1) {
    return { fullAddress: null, city: null, state: null, pincode: null };
  }

  const firstLine = lines[startIdx].replace(/^address\b[:\-]?\s*/i, "").trim();

  const addressLines = [];
  if (firstLine) addressLines.push(firstLine);

  for (let j = startIdx + 1; j < Math.min(lines.length, startIdx + 8); j++) {
    if (
      /^(dob|date of birth|year of birth|gender|male|female|government of india)\b/i.test(
        lines[j]
      )
    ) {
      break;
    }
    addressLines.push(lines[j]);
  }

  const addrBlob = normalizeText(addressLines.join("\n"));
  const pincode =
    extractPincodeFromString(addrBlob) ||
    extractPincodeFromString(joined) ||
    null;

  let state = fuzzyFindStateInText(addrBlob) || fuzzyFindStateInText(joined);
  let city = null;

  const distMatch = addrBlob.match(/\bdistrict\b[:\-]?\s*([^,\n]+)/i);
  const districtFromLabel = distMatch ? distMatch[1].trim() : null;

  // Parse "..., CITY, STATE 123456" or "LOCALITY CITY, STATE PIN"
  for (let i = addressLines.length - 1; i >= 0; i--) {
    const ln = addressLines[i];
    const stripped = stripPinFromLine(ln);
    const st = fuzzyFindStateInText(stripped);
    const parts = stripped
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      const lastSeg = parts[parts.length - 1];
      const restLast = stripPinFromLine(lastSeg);
      const stateGuess = fuzzyFindStateInText(restLast);
      if (stateGuess || extractPincodeFromString(lastSeg)) {
        if (!state && stateGuess) state = stateGuess;
        const maybeCitySeg = parts[parts.length - 2];
        if (!city && maybeCitySeg) {
          const c = stripPinFromLine(maybeCitySeg);
          if (
            c.length >= 2 &&
            (!state || !c.toUpperCase().includes(String(state).toUpperCase()))
          ) {
            city = c.replace(/\bdistrict\b/gi, "").trim() || maybeCitySeg;
          }
        }
      }
    }

    if (st && extractPincodeFromString(ln)) {
      city = stripped
        .replace(new RegExp(String(st), "gi"), "")
        .replace(/\b\d{3}\s+\d{3}\b|\b\d{6}\b/g, "")
        .replace(/^[,:-\s]+|[,:-\s]+$/g, "")
        .trim();
      if (!state) state = st;
      break;
    }
  }

  if (!city && districtFromLabel) city = districtFromLabel;

  if (!city && addressLines.length >= 2) {
    let pinIdx = -1;
    for (let i = 0; i < addressLines.length; i++) {
      if (extractPincodeFromString(addressLines[i])) pinIdx = i;
    }
    if (pinIdx > 0) {
      city = stripPinFromLine(addressLines[pinIdx - 1]);
    }
  }

  let fullAddress = addrBlob.length ? addrBlob.replace(/\s+/g, " ").trim() : null;
  fullAddress = clipLeadingAddressNoise(fullAddress) || fullAddress;

  if (city) {
    city = city
      .replace(/\bfather'?s\b|\bmother'?s\b|\bhusband'?s\b/gi, "")
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
      .trim();
    if (!city.length) city = null;
  }
  if (state)
    state = stripPinFromLine(state).replace(/\s+/g, " ").trim() || state;

  city = salvageCityFromBlob(fullAddress || addrBlob, city);
  const hintCity = pinPrefixCityHint(pincode, state || fuzzyFindStateInText(fullAddress || ""));
  if (hintCity && (!city || vowelRatioLetters(city) < 0.12)) {
    city = hintCity;
  }
  if (city) city = dedupeAdjacentTokens(city);

  return { fullAddress, city: city || null, state: state || null, pincode };
}

/** Must stay above looksLikeAllCapsWholeNameLine / caps fallback */
const NAME_STOP_TOKENS = new Set([
  "GOVERNMENT",
  "INDIA",
  "UNIQUE",
  "IDENTIFICATION",
  "AUTHORITY",
  "ADDRESS",
  "AADHAAR",
  "MALE",
  "FEMALE",
  "STATE",
  "PINCODE",
  "DISTRICT",
  "JAIPUR",
  "DEPARTMENT",
  "INCOME",
  "PROFILE",
  "SERVICES",
]);

/**
 * OCR often reads "Bharat / India / Government" near the photo as random tokens
 * (e.g. "HARAT" ≈ BHARAT). Reject those so they are never treated as the holder name.
 */
const AADHAAR_HEADER_TRASH = [
  "BHARAT",
  "INDIA",
  "GOVERNMENT",
  "IDENTIFICATION",
  "INCREDIBLE",
  "SARKAR",
  "DIGILOCKER",
  "AUTHORITY",
  "UNIQUE",
  "AADHAAR",
  "UIDAI",
  "ENROLLMENT",
];

/** Exact "BHARAT" / "INDIA" can be real given names; only treat OCR-corrupted spellings as header trash. */
const HEADER_TRASH_CAN_BE_LEGAL_NAME = new Set(["BHARAT", "INDIA"]);

/**
 * @param {{ relaxedBharatIndiaOcr?: boolean }} [opts] — when true (all-caps name lines only),
 *   do not treat "HARAT"-style single-edit OCR of BHARAT as trash (may be a real name).
 */
function tokenLooksLikeCorruptedHeaderWord(alphaToken, opts = {}) {
  const { relaxedBharatIndiaOcr = false } = opts;
  const u = String(alphaToken || "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  if (u.length < 4 || u.length > 14) return false;
  for (const ref of AADHAAR_HEADER_TRASH) {
    if (HEADER_TRASH_CAN_BE_LEGAL_NAME.has(ref)) {
      if (u === ref) continue;
      if (relaxedBharatIndiaOcr) continue;
      if (levenshtein(u, ref) <= 2) return true;
      continue;
    }
    if (u === ref) return true;
    if (levenshtein(u, ref) <= 2) return true;
  }
  return false;
}

function lineHasCorruptedAadhaarHeaderToken(line) {
  for (const w of String(line || "").split(/\s+/).filter(Boolean)) {
    const alpha = w.replace(/[^A-Za-z]/g, "");
    if (alpha.length >= 4 && tokenLooksLikeCorruptedHeaderWord(alpha)) return true;
  }
  return false;
}

/** Lines like "HARAT arerse qe diel Y IBET" — long CAPS token + long lowercase gibberish (not a real name shape). */
function looksLikeMixedCapsOcrJunkLine(line) {
  const s = String(line || "").trim();
  if (s.length < 8) return false;
  if (!/[a-z]{5,}/.test(s)) return false;
  if (!/\b[A-Z]{4,}\b/.test(s)) return false;
  if (/^([A-Z][a-z]+)(\s+[A-Z][a-z]+)*$/.test(s)) return false;
  if (/^[A-Z]{2,}(\s+[A-Z]{2,})+$/.test(s)) return false;
  if (/^[a-z][a-z\s]+$/i.test(s) && !/[A-Z]{4,}/.test(s)) return false;
  return true;
}

function isGarbageNameOcrLine(line) {
  const s = String(line || "").trim();
  if (!s.length) return true;
  /** All-caps holder names are checked with relaxed BHARAT/INDIA OCR elsewhere. */
  if (looksLikeAllCapsWholeNameLine(s)) return false;
  if (lineHasCorruptedAadhaarHeaderToken(s)) return true;
  if (looksLikeMixedCapsOcrJunkLine(s)) return true;
  if (/\b(qe|ibet|arerse|rerse|diel|diele|diels)\b/i.test(s)) return true;
  return false;
}

/** Strong header lines — end merging when the next line is a different ID field. */
function isNameStructuralStopLine(s) {
  const t = String(s || "").trim();
  if (!t.length) return true;
  if (
    new RegExp(
      `\\b(dob|date of birth|year of birth|address|gender|\\bmale\\b|\\bfemale\\b|pin\\s*:|pincode|vid\\b|${D_AADHAAR}|aadhaar|unique identification)\\b`,
      "i"
    ).test(t)
  )
    return true;
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(t)) return true;
  if (/\b\d{4}\s+\d{4}\s+\d{4}\b/.test(t) || /\b\d{12}\b/.test(t)) return true;
  if (/\b(?:PAN|PAN\s*NO|Permanent Account Number)\b/i.test(t)) return true;
  if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(t.toUpperCase())) return true;
  return false;
}

/** Second/third line looks like surname / continuation (OCR splits full name). */
function looksLikeNameContinuationLine(s) {
  const t = String(s || "").trim();
  if (!t.length || isNameStructuralStopLine(t)) return false;
  if (/\bfather'?s\b|\bmother'?s\b|\bhusband'?s\b|\bwife'?s\b/i.test(t))
    return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters < 2 || letters / t.length < 0.45) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return false;
  const loneAllCapsTok = /^[A-Z][A-Z'.-]{1,29}$/.test(t) && /^[A-Z'.-]+$/u.test(t);
  const allCapsOrTitle =
    /^[A-Z]{2,}(?:\s+[A-Z]{2,})*$/.test(t) ||
    /^[A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)*$/.test(t) ||
    /^[A-Z]\.(?:\s+[A-Za-z.-]+)+$/.test(t) ||
    loneAllCapsTok;
  if (!allCapsOrTitle && words.length === 1) {
    const w = words[0];
    if (!/^[A-Za-z]{2,30}$/.test(w)) return false;
  }
  const noise =
    /\b(GOVERNMENT|AUTHORITY|UNIQUE|INDIA|SERVICES|IDENTIFICATION)\b/i;
  if (noise.test(t)) return false;
  if (isGarbageNameOcrLine(t)) return false;
  return true;
}

function stripLeadingNameLabel(s) {
  return String(s || "")
    .trim()
    .replace(new RegExp(`^\\s*(?:name|${D_NAME})\\b[/\\s:：\\-–—]*`, "iu"), "")
    .trim();
}

/** Concatenate OCR lines containing one full name split across wraps. */
function mergeAdjacentPersonName(lines, idx) {
  const raw = String(lines[idx] || "").trim();
  const afterLabel = stripLeadingNameLabel(raw);
  const trimmedAfterLabel = clipNameAtFollowingField(afterLabel).trim();

  const hasEmbeddedNameBeyondLabel =
    trimmedAfterLabel.length >= 2 && !/^[/:：\-–—|\s]+$/.test(trimmedAfterLabel);
  const bareNameHeading =
    new RegExp(`\\b(?:name|${D_NAME})\\b`, "i").test(raw) && !hasEmbeddedNameBeyondLabel;

  let first =
    trimmedAfterLabel.length >= 2
      ? trimmedAfterLabel
      : clipNameAtFollowingField(stripLeadingNameLabel(raw)).trim();

  /** Recurse only for a bare Name label with no text after it on the same line. */
  if (bareNameHeading) {
    for (let k = idx + 1; k < Math.min(lines.length, idx + 5); k += 1) {
      const n0 = stripLeadingNameLabel(lines[k]?.trim() || "").trim();
      if (!n0 || isNameStructuralStopLine(n0)) break;
      if (isGarbageNameOcrLine(n0)) continue;
      if (!looksLikePersonName(n0) && !looksLikeAllCapsWholeNameLine(n0)) continue;
      return mergeAdjacentPersonName(lines, k);
    }
    return null;
  }

  first = trimmedAfterLabel.length >= 2 ? trimmedAfterLabel : clipNameAtFollowingField(first).trim();
  if (!first.length || isNameStructuralStopLine(first)) return null;

  let merged = first;
  for (let k = idx + 1; k < Math.min(lines.length, idx + 5); k += 1) {
    const nxt = lines[k]?.trim();
    if (!nxt || isNameStructuralStopLine(nxt)) break;
    if (isGarbageNameOcrLine(nxt)) break;
    if (!looksLikeNameContinuationLine(nxt)) break;

    const trial = `${merged} ${nxt}`.trim();
    if (trial.length > 130) break;
    merged = trial;
    if (merged.split(/\s+/).length >= 12) break;
  }

  if (isGarbageNameOcrLine(merged)) return null;
  if (!looksLikePersonName(merged) && !looksLikeAllCapsWholeNameLine(merged)) {
    if (!looksLikePersonName(first) || isGarbageNameOcrLine(first)) return null;
    merged = first;
  }
  if (isGarbageNameOcrLine(merged)) return null;
  return merged;
}

/** Entire line is ONLY ALL-CAPS Latin tokens (often one OCR line per given name). */
function looksLikeAllCapsWholeNameLine(s) {
  const t = String(s || "").trim();
  if (t.length < 5 || t.length > 110) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 10) return false;
  if (!words.every((w) => /^[A-Z.'.-]+$/.test(w))) return false;
  if (NAME_STOP_TOKENS.has(words[0])) return false;
  if (words.length >= 2 && NAME_STOP_TOKENS.has(words[0]) && NAME_STOP_TOKENS.has(words[1]))
    return false;
  try {
    if (/\b(UNIQUE|AUTHORITY|IDENTIFICATION|DOCUMENT|SERVICES)\b/i.test(t)) return false;
  } catch (_) {
    /** ignore */
  }
  const joined = words.join(" ");
  const minLenForSingleWord = words.length === 1 ? 4 : 5;
  if (joined.length < minLenForSingleWord) return false;
  if (joined.length >= 45 && vowelRatioLetters(joined.toLowerCase()) < 0.08)
    return false;
  if (words.some((w) => tokenLooksLikeCorruptedHeaderWord(w, { relaxedBharatIndiaOcr: true })))
    return false;
  const vrAll = vowelRatioLetters(joined.toLowerCase());
  if (words.length >= 2 && vrAll < 0.12) return false;
  return true;
}

/**
 * Join RAJESH + KUMAR SHARMA (split across lines before DOB).
 * maxBackward avoids eating unrelated header lines far above anchor.
 */
function glueGovernmentEnglishUppercaseName(lines, anchorIdx, maxBackward = 4) {
  const forward = mergeAdjacentPersonName(lines, anchorIdx);
  const partsAhead = forward ? forward.split(/\s+/).filter(Boolean) : [];

  const backChunks = [];
  for (
    let b = anchorIdx - 1;
    b >= Math.max(0, anchorIdx - maxBackward);
    b -= 1
  ) {
    const ln = String(lines[b] || "").trim();
    if (!ln || /UNIQUE|UIDAI|GOVERNMENT|^VID\b|^DOB|^Address/i.test(ln)) break;

    let frag = stripLeadingNameLabel(ln).trim();
    frag = clipNameAtFollowingField(frag).trim();
    if (!frag.length || isNameStructuralStopLine(frag)) break;

    if (looksLikeAllCapsWholeNameLine(frag)) {
      const toks = frag.split(/\s+/).filter(Boolean);
      let stop = false;
      for (const tok of toks) {
        if (NAME_STOP_TOKENS.has(tok)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
      backChunks.unshift(frag.trim());
    } else if (/^[A-Z][A-Z'.-]+$/.test(frag) && frag.length >= 4) {
      if (NAME_STOP_TOKENS.has(frag)) break;
      if (/^(MAY|APR|MAR|PIN|OTP)$/i.test(frag)) break;
      backChunks.unshift(frag);
    } else {
      break;
    }

    if (backChunks.join(" ").split(/\s+/).length >= 10) break;
  }

  if (!partsAhead.length && !backChunks.length) return null;
  let combined = [...backChunks.flatMap((x) => x.split(/\s+/)), ...partsAhead];
  combined = combined.filter(Boolean);
  combined = [...new Set(combined.map((x) => x.trim()))];
  let finalStr = combined.join(" ").trim();
  finalStr = clipNameAtFollowingField(finalStr);
  finalStr = finalStr.replace(/\s+/g, " ").trim();

  if (isGarbageNameOcrLine(finalStr)) {
    if (forward && looksLikePersonName(forward) && !isGarbageNameOcrLine(forward))
      return forward;
    return null;
  }

  if (!looksLikePersonName(finalStr) && !looksLikeAllCapsWholeNameLine(finalStr)) {
    if (forward && looksLikePersonName(forward) && !isGarbageNameOcrLine(forward))
      return forward;
    const clippedAhead = clipNameAtFollowingField(partsAhead.join(" "));
    if (
      clippedAhead &&
      partsAhead.join(" ").trim().split(/\s+/).length >= 2 &&
      looksLikePersonName(clippedAhead) &&
      !isGarbageNameOcrLine(clippedAhead)
    )
      return clippedAhead;
    if (forward && !isGarbageNameOcrLine(forward)) return forward;
    return null;
  }

  const titleOrPlain = /^[A-Z]{2,}(\s+[A-Z]{2,})*$/.test(finalStr.trim())
    ? titleCaseWords(finalStr.toLowerCase())
    : finalStr.trim();
  return titleOrPlain;
}

/** Line looks like person's name from OCR (Latin / Devanagari may appear beside English). */
function looksLikePersonName(s) {
  const t = String(s || "").trim();
  if (t.length < 2 || t.length > 130) return false;
  if (/^(male|female|others?|transgender)\b/i.test(t)) return false;
  if (/\bgovernment\b|\b(uidai|aadhaar|unique|identification|india|enrollment|vid)\b/i.test(t))
    return false;
  if (/\d{4}\s+\d{4}\s+\d{4}/.test(t) || /\b\d{12}\b/.test(t)) return false;
  if (/\bfather\b|\bmother\b|\bhusband\b|\bwife\b|\bspouse\b|\bc\/o\b|\bs\/o\b|\bw\/o\b|\bd\/o\b/i.test(t))
    return false;
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(t)) return false;

  const hasInitialDots = /\b[A-Z]\.(?:\s+[A-Z]\.)*\s+[\p{L}]/iu.test(t);
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters < 2 && !/[\u0900-\u097F]/u.test(t)) return false;
  if (!hasInitialDots && letters < 3) return false;

  const softDen = Math.max(
    1,
    (t.match(/[A-Za-z\s.'\-]/g) || []).length
  );
  let ratio = letters / softDen;
  if (ratio < 0.42 && !hasInitialDots) return false;
  if (!hasInitialDots && ratio < 0.52 && letters < 10) return false;

  const wordsAll = t.split(/\s+/).filter(Boolean);
  const alphaWords = wordsAll.filter((w) =>
    /^[\p{L}'.-]{2,}(?:\.[\p{L}.-]*)?$/u.test(w)
  ).length;
  if (ratio < 0.55 && !(alphaWords >= 2 && letters >= 6 && ratio >= 0.41)) return false;

  const upperCount = (t.match(/[A-Z]/g) || []).length;
  if (letters > 12 && upperCount / letters > 0.92) {
    const noise =
      /\b(UNIQUE|AUTHORITY|ADDRESS|PROFILE|SERVICES|DOCUMENT|IDENTIFICATION|DEPARTMENT)\b/i;
    if (noise.test(t)) return false;
  }

  if (isGarbageNameOcrLine(t)) return false;

  const cleaned = t.replace(/[^\p{L} .'-]/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned.replace(/\./g, "").length >= 2;
}

function clipNameAtFollowingField(s) {
  let t = String(s || "").trim().replace(/^[/:：\-–—|]+\s*/, "");
  const stop = /\b(?:DOB|Date of Birth|Year of Birth|Address|Gender|M\/F|Male|Female|Father'?s Name|Mother'?s Name|Father|Mother|Pincode|\bPIN\b|VID|Your Photo|Unique Identification)\b/i;
  const m = stop.exec(t);
  if (m && m.index > 1) {
    t = t.slice(0, m.index);
  }
  return t.replace(/[,:;\s]+$/, "").trim();
}

function cleanNameCandidate(raw) {
  return String(raw || "")
    .replace(/[^\p{L}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .trim();
}

function extractName(text) {
  const lines = toLines(text);
  const upperLines = lines.map((l) => l.toUpperCase());

  const nameLabelRe = new RegExp(
    `^(?!.*\\b(?:father|mother|husband|wife|parent|guardian)\\b).*(?:\\bname\\b|${D_NAME})`,
    "i"
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const embedded = line.match(
      new RegExp(
        `\\b(?:name|${D_NAME})\\b[/\\s:：\\-–—]*([\\p{L}\\d\\s.'\\-]{2,230})`,
        "iu"
      )
    );
    if (embedded) {
      let after = clipNameAtFollowingField(embedded[1]).trim();
      const firstTok = after.split(/\s+/)[0] || "";
      if (/^(father|mother|father'?s|mother'?s)$/i.test(firstTok)) {
        /** skip parent's label line masquerading as embedded */
      } else {
        const pieces = [...new Set([after, after.split(/[|,]/)[0]?.trim()])].filter(
          Boolean
        );
        for (const piece of pieces) {
          if (!piece || piece.length < 2) continue;
          if (
            looksLikePersonName(piece) ||
            looksLikeAllCapsWholeNameLine(piece.replace(/\s+/g, " ").trim())
          ) {
            const out = cleanNameCandidate(piece);
            if (out.length >= 2) return out;
          }
        }
      }
    }

    const isLabelOnly = new RegExp(
      `^\\s*(?:name|${D_NAME})\\b[/\\s:：\\-–—]*$`,
      "i"
    ).test(line);
    const isPanNameLine =
      nameLabelRe.test(line) ||
      new RegExp(`^\\s*(?:name|${D_NAME})\\b\\s`, "im").test(line) ||
      /^\s*name\s+[A-Za-z\u0900-\u097F]/iu.test(line) ||
      isLabelOnly;

    if (
      isPanNameLine ||
      new RegExp(`^\\s*(?:name|${D_NAME})\\s*[:\\-]\\s`, "im").test(line)
    ) {
      let inlineRaw = stripLeadingNameLabel(line).trim();
      inlineRaw = clipNameAtFollowingField(inlineRaw);

      const tries = [...new Set([inlineRaw, inlineRaw.split(/[,|]/)[0]?.trim()].filter(Boolean))];
      for (const ip of tries) {
        if (ip.length < 2) continue;
        const okPiece =
          looksLikePersonName(ip) || looksLikeAllCapsWholeNameLine(ip.trim());
        if (okPiece) {
          const mergedSame = mergeAdjacentPersonName(lines, i);
          const pick =
            mergedSame &&
            mergedSame.replace(/\s+/g, " ").length >= ip.replace(/\s+/g, " ").length
              ? mergedSame
              : ip;
          return cleanNameCandidate(pick);
        }
      }

      /** Label-only (“Name”) or noisy inline — scan forward */
      const mergedFromBlock = mergeAdjacentPersonName(lines, i);
      if (mergedFromBlock) return cleanNameCandidate(mergedFromBlock);

      for (let k = i + 1; k < Math.min(lines.length, i + 5); k++) {
        const next = lines[k];
        if (!next) continue;
        if (
          looksLikePersonName(next) ||
          looksLikeAllCapsWholeNameLine(next)
        ) {
          const merged = mergeAdjacentPersonName(lines, k);
          if (merged) return cleanNameCandidate(merged);
        }
      }
    }
  }

  function tokenNear(t, ref) {
    const u = String(t || "").replace(/[^A-Za-z]/g, "").toUpperCase();
    if (u.length < 3) return false;
    return u === ref || (u.length >= 4 && levenshtein(u, ref) <= 1);
  }

  function looksLikeIncomeTaxHeaderLine(line) {
    const toks = String(line || "")
      .split(/\s+/)
      .filter(Boolean);
    let hits = 0;
    for (const tok of toks) {
      if (tokenNear(tok, "INCOME")) hits += 1;
      else if (tokenNear(tok, "TAX")) hits += 1;
      else if (tokenNear(tok, "DEPARTMENT")) hits += 1;
    }
    return hits >= 2;
  }

  /**
   * PAN cards often follow a stable block:
   * INCOME TAX DEPARTMENT / GOVT OF INDIA
   * <NAME>
   * <FATHER NAME>
   * <DOB>
   * <PAN>
   *
   * Prefer the first strong name candidate that appears after the header
   * and before DOB / PAN / Father labels.
   */
  const incomeTaxIdx = lines.findIndex(
    (l) =>
      /\bincome\s+tax\s+department\b/i.test(l) || looksLikeIncomeTaxHeaderLine(l)
  );
  if (incomeTaxIdx !== -1) {
    const stopRe =
      /\b(permanent\s+account\s+number|date\s+of\s+birth|dob|father|mother|signature|govt|government|india|income\s+tax|department)\b/i;
    for (let j = incomeTaxIdx + 1; j < Math.min(lines.length, incomeTaxIdx + 12); j += 1) {
      const cand = String(lines[j] || "").trim();
      if (!cand) continue;
      if (/^name$/i.test(cand)) continue;
      if (stopRe.test(cand)) continue;
      if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(cand.toUpperCase())) continue;
      if (/\b\d{2}[\/\-.]\d{2}[\/\-.]\d{4}\b/.test(cand)) continue;
      if (isNameStructuralStopLine(cand)) continue;

      const ok = looksLikePersonName(cand) || looksLikeAllCapsWholeNameLine(cand);
      if (!ok) continue;
      return cleanNameCandidate(cand);
    }
  }

  /** Fallback: anchor around PAN number line (OCR sometimes reorders blocks). */
  const panNumberLineNear = lines.findIndex((l) =>
    /\b[A-Z]{5}\d{4}[A-Z]\b/.test(String(l || "").toUpperCase())
  );
  if (panNumberLineNear !== -1) {
    const badRe =
      /\b(income\s+tax|department|permanent\s+account\s+number|govt|government|india|father|mother|dob|date\s+of\s+birth|signature|pan)\b/i;
    const windowStart = Math.max(0, panNumberLineNear - 8);
    const windowEnd = Math.min(lines.length, panNumberLineNear + 9);
    let best = null;
    let bestScore = -1;

    for (let j = windowStart; j < windowEnd; j += 1) {
      if (j === panNumberLineNear) continue;
      const cand = String(lines[j] || "").trim();
      if (!cand || cand.length < 2) continue;
      if (/^name$/i.test(cand)) continue;
      if (badRe.test(cand)) continue;
      if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(cand.toUpperCase())) continue;
      if (/\b\d{2}[\/\-.]\d{2}[\/\-.]\d{4}\b/.test(cand)) continue;
      if (isGarbageNameOcrLine(cand)) continue;

      let cleaned = clipNameAtFollowingField(cand);
      cleaned = cleaned.replace(/\s+/g, " ").trim();
      if (!cleaned || cleaned.length < 2) continue;

      const ok =
        looksLikePersonName(cleaned) || looksLikeAllCapsWholeNameLine(cleaned);
      if (!ok) continue;

      const toks = cleaned.split(/\s+/).filter(Boolean);
      let score = 0;
      if (/^[A-Z]{2,}(\s+[A-Z]{2,})+$/.test(cleaned)) score += 2;
      if (/^([A-Z][a-z]+)(\s+[A-Z][a-z]+)+$/.test(cleaned)) score += 3;
      if (toks.length >= 2 && toks.length <= 5) score += 2;
      if (toks.length === 1) score -= 2;
      score -= Math.min(6, Math.abs(j - panNumberLineNear)) * 0.25;

      if (score > bestScore) {
        bestScore = score;
        best = cleaned;
      }
    }

    if (best) return cleanNameCandidate(best);
  }

  const govIdx = upperLines.findIndex((l) => l.includes("GOVERNMENT OF INDIA"));
  if (govIdx !== -1) {
    for (let j = govIdx + 1; j < Math.min(lines.length, govIdx + 10); j++) {
      const candidate = lines[j];
      if (
        /UNIQUE IDENTIFICATION|UIDAI|ADDRESS|ENR.*MENT|YOUR AADHAAR|VID\b/i.test(
          candidate
        )
      )
        continue;
      if (/^(?:ADDRESS|Male|Female|DOB|M\/F\b)/i.test(candidate)) continue;
      if (/^\d{1,2}[\/\-]\d{1,2}/.test(candidate)) continue;
      if (isGarbageNameOcrLine(candidate)) continue;

      const okHuman =
        looksLikePersonName(candidate) || looksLikeAllCapsWholeNameLine(candidate);

      const looksLikeStructuralHeader =
        new RegExp(`^(?:Enrollment|${D_AADHAAR}|Aadhaar|Help|WWW\\.|Dial|Government)`, "i").test(
          candidate.trim()
        );
      if (!okHuman || looksLikeStructuralHeader) continue;

      const merged = glueGovernmentEnglishUppercaseName(lines, j);
      if (merged) return cleanNameCandidate(merged);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bfather'?s name\b|\bmother'?s name\b|\bname of father\b/i.test(line))
      continue;
    const part = line.replace(/^.*?\bname\b[\/\s:：\-–—]*/i, "").trim();
    if (part.length >= 2 && looksLikePersonName(part.split(/[,|]/)[0])) {
      return cleanNameCandidate(part.split(/[,|]/)[0]);
    }
    const prev = lines[i - 1];
    if (
      prev &&
      looksLikePersonName(prev) &&
      !/\b\d{12}\b/.test(prev) &&
      !/\bfather|\bmother\b/i.test(prev)
    ) {
      return cleanNameCandidate(prev);
    }
  }

  const panIdx = lines.findIndex((l) =>
    /\bPermanent Account Number\b|\bincome tax department\b/i.test(l)
  );
  if (panIdx !== -1) {
    const start = Math.max(0, panIdx - 6);
    const end = Math.min(lines.length, panIdx + 3);
    for (let w = start; w < end; w += 1) {
      const cand = lines[w];
      if (
        cand &&
        (looksLikePersonName(cand) || looksLikeAllCapsWholeNameLine(cand))
      ) {
        const merged = mergeAdjacentPersonName(lines, w);
        if (merged) return cleanNameCandidate(merged);
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /\b\d{2}[\/\-.]\d{2}[\/\-.]\d{4}\b/.test(line) ||
      /\b(dob|date of birth)\b/i.test(line)
    ) {
      const prevIdx = i - 1;
      const prev2Idx = i - 2;
      for (const idx of [prevIdx, prev2Idx]) {
        if (idx < 0 || !lines[idx]) continue;
        if (
          !looksLikePersonName(lines[idx]) &&
          !looksLikeAllCapsWholeNameLine(lines[idx])
        )
          continue;
        const merged = mergeAdjacentPersonName(lines, idx);
        if (merged) return cleanNameCandidate(merged);
      }
      break;
    }
  }

  const panNumberLine = lines.findIndex((l) =>
    /\b[A-Z]{5}\d{4}[A-Z]\b/.test(l.toUpperCase())
  );
  if (panNumberLine !== -1) {
    for (let j = Math.max(0, panNumberLine - 4); j < panNumberLine; j++) {
      const c = lines[j];
      if (!c || /^name\b/i.test(c)) continue;
      if (!looksLikePersonName(c) && !looksLikeAllCapsWholeNameLine(c)) continue;
      const merged = mergeAdjacentPersonName(lines, j);
      if (merged) return cleanNameCandidate(merged);
    }
  }

  const capsFallback = extractNameFromAllCapsLines(lines);
  if (capsFallback) return capsFallback;

  return null;
}

/**
 * Last resort for blurry OCR: contiguous ALL-CAPS Latin tokens.
 */
function extractNameFromAllCapsLines(lines) {
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];
    if (!line || line.length > 110) continue;
    if (/\bgovernment\b|^address\b|^\s*\d|^vid\b|^uid\b/i.test(line)) continue;

    const rx = /\b([A-Z]{2,}(?:\s+[A-Z]{2,}){1,6})\b/g;
    let m;
    while ((m = rx.exec(line)) !== null) {
      const block = m[1].trim();
      const tokens = block.split(/\s+/);
      if (tokens.some((t) => NAME_STOP_TOKENS.has(t))) continue;
      if (tokens.some((t) => tokenLooksLikeCorruptedHeaderWord(t, { relaxedBharatIndiaOcr: true })))
        continue;
      if (isGarbageNameOcrLine(block)) continue;
      if (tokens.every((t) => t.length < 3)) continue;
      const joined = tokens.join(" ");
      const vr = vowelRatioLetters(joined);
      if (joined.length >= 6 && vr >= 0.1 && vr <= 0.55) {
        return titleCaseWords(joined.toLowerCase());
      }
    }
  }
  return null;
}

module.exports = {
  extractAadhaarNumber,
  extractPanNumber,
  extractDOB,
  extractAddress,
  extractName,
  expandOcrStructuralNewlines,
};
