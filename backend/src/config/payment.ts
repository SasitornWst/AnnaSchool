import { fileURLToPath } from "node:url";

export const MAX_PAYMENT_PROOF_FILE_SIZE_BYTES =
  20 * 1024 * 1024;

export const PAYMENT_PROOF_DIRECTORY =
  fileURLToPath(
    new URL(
      "../../private/payment-proofs/",
      import.meta.url,
    ),
  );

export function getPromptPayId(): string {
  const promptPayId = process.env.PROMPTPAY_ID?.trim();

  if (promptPayId === undefined || promptPayId === "") {
    throw new Error(
      "Missing environment variable: PROMPTPAY_ID",
    );
  }

  return promptPayId;
}

export function getReceiptIssuer() {
  return {
    name:
      process.env.RECEIPT_ISSUER_NAME?.trim() ||
      "Anna English School",
    taxId:
      process.env.RECEIPT_TAX_ID?.trim() ||
      "ยังไม่ได้กำหนด",
    address:
      process.env.RECEIPT_ADDRESS?.trim() ||
      "ยังไม่ได้กำหนด",
  };
}
