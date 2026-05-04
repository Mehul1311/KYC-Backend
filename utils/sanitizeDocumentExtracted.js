/**
 * Holder name is taken only from PAN OCR. Aadhaar extractedData must never
 * include fullName (strip legacy keys from DB / defensive saves).
 */
function omitAadhaarFullName(extractedData) {
  if (!extractedData || typeof extractedData !== "object") return extractedData;
  if (!Object.prototype.hasOwnProperty.call(extractedData, "fullName")) {
    return extractedData;
  }
  const { fullName: _fn, ...rest } = extractedData;
  return rest;
}

function sanitizeAadhaarDocumentPlain(doc) {
  if (!doc || doc.type !== "aadhaar" || !doc.extractedData) return doc;
  return {
    ...doc,
    extractedData: omitAadhaarFullName(doc.extractedData),
  };
}

module.exports = {
  omitAadhaarFullName,
  sanitizeAadhaarDocumentPlain,
};
