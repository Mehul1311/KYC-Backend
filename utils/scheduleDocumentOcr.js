const Document = require("../models/Document");
const { processDocument } = require("./ocrPipeline");
const { omitAadhaarFullName } = require("./sanitizeDocumentExtracted");

/**
 * Runs OCR in the background and updates the Document row (same lifecycle as upload).
 */
function scheduleDocumentOcr(documentId, fileUrl, type) {
  setImmediate(() => {
    processDocument(fileUrl, type)
      .then((extractedData) => {
        let data = extractedData;
        if (type === "aadhaar") {
          data = omitAadhaarFullName(data);
        }
        return Document.findByIdAndUpdate(
          documentId,
          {
            $set: {
              status: "verified",
              extractedData: data,
              processedAt: new Date(),
              failureReason: null,
            },
          },
          { returnDocument: "after" }
        );
      })
      .catch((err) => {
        const msg = err?.message || "Processing failed";
        console.error("[OCR] Background job failed for document", documentId, msg);
        return Document.findByIdAndUpdate(documentId, {
          $set: {
            status: "failed",
            failureReason: msg,
            processedAt: new Date(),
          },
        });
      });
  });
}

module.exports = { scheduleDocumentOcr };
