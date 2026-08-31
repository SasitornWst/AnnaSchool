import multer from "multer";

import {
  MAX_PAYMENT_PROOF_FILE_SIZE_BYTES,
} from "../config/payment.ts";

export const paymentProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PAYMENT_PROOF_FILE_SIZE_BYTES,
    files: 1,
    fields: 0,
  },
}).single("proof");
