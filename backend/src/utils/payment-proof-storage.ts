import { randomUUID } from "node:crypto";
import {
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { fileTypeFromBuffer } from "file-type";

import { PAYMENT_PROOF_DIRECTORY } from "../config/payment.ts";

const allowedTypes = {
  "image/jpeg": {
    extension: "jpg",
    originalExtensions: new Set([".jpg", ".jpeg"]),
  },
  "image/png": {
    extension: "png",
    originalExtensions: new Set([".png"]),
  },
  "application/pdf": {
    extension: "pdf",
    originalExtensions: new Set([".pdf"]),
  },
} as const;

export interface InspectedPaymentProof {
  originalFileName: string;
  mimeType: keyof typeof allowedTypes;
  extension: string;
  fileSizeBytes: number;
}

export async function inspectPaymentProof(
  file: Express.Multer.File,
): Promise<InspectedPaymentProof> {
  const detectedType = await fileTypeFromBuffer(file.buffer);

  if (
    detectedType === undefined ||
    !(detectedType.mime in allowedTypes)
  ) {
    throw new Error("UNSUPPORTED_PAYMENT_PROOF_TYPE");
  }

  const mimeType =
    detectedType.mime as keyof typeof allowedTypes;
  const allowedType = allowedTypes[mimeType];
  const originalFileName = path
    .basename(file.originalname)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 255);
  const originalExtension = path
    .extname(originalFileName)
    .toLowerCase();

  if (
    originalFileName === "" ||
    !allowedType.originalExtensions.has(
      originalExtension as never,
    ) ||
    file.mimetype !== mimeType
  ) {
    throw new Error("PAYMENT_PROOF_TYPE_MISMATCH");
  }

  return {
    originalFileName,
    mimeType,
    extension: allowedType.extension,
    fileSizeBytes: file.size,
  };
}

export async function savePaymentProof(
  buffer: Buffer,
  extension: string,
): Promise<string> {
  await mkdir(PAYMENT_PROOF_DIRECTORY, {
    recursive: true,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const storedFileName = `${randomUUID()}.${extension}`;
    const filePath = path.join(
      PAYMENT_PROOF_DIRECTORY,
      storedFileName,
    );

    try {
      await writeFile(filePath, buffer, { flag: "wx" });
      return storedFileName;
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
    }
  }

  throw new Error("Could not allocate a unique proof filename");
}

export function resolvePaymentProofPath(
  storedFileName: string,
): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf)$/i.test(
      storedFileName,
    )
  ) {
    throw new Error("Invalid stored payment proof filename");
  }

  const directory = path.resolve(PAYMENT_PROOF_DIRECTORY);
  const filePath = path.resolve(directory, storedFileName);

  if (!filePath.startsWith(`${directory}${path.sep}`)) {
    throw new Error("Invalid payment proof path");
  }

  return filePath;
}

export async function deletePaymentProofIfExists(
  storedFileName: string,
): Promise<void> {
  try {
    await unlink(resolvePaymentProofPath(storedFileName));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}
