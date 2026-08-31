import { Router } from "express";
import type {
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";
import QRCode from "qrcode";

import { databasePool } from "../config/database.ts";
import { getPromptPayId } from "../config/payment.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { paymentProofUpload } from "../middlewares/payment-proof-upload.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import type { AuthTokenPayload } from "../utils/jwt.ts";
import {
  deletePaymentProofIfExists,
  inspectPaymentProof,
  resolvePaymentProofPath,
  savePaymentProof,
} from "../utils/payment-proof-storage.ts";
import { createPromptPayPayload } from "../utils/promptpay.ts";
import { createReceiptPdf } from "../utils/receipt-pdf.ts";

interface ParentPaymentRow extends RowDataPacket {
  id: number;
  enrollmentId: number;
  amount: string | number;
  paymentMethod: string | null;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  note: string | null;
  createdAt: string;
  studentId: number;
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  levelName: string;
  receiptId: number | null;
  receiptNumber: string | null;
}

interface OwnedPaymentRow extends RowDataPacket {
  paymentId: number;
  amount: string | number;
  status: string;
}

interface ParentProofRow extends RowDataPacket {
  id: number;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
}

interface ParentProofFileRow extends RowDataPacket {
  id: number;
  storedFileName: string;
  originalFileName: string;
}

interface ParentReceiptRow extends RowDataPacket {
  id: number;
  receiptNumber: string;
  amount: string | number;
  issuedAt: string;
  note: string | null;
}

interface ParentReceiptDownloadRow extends RowDataPacket {
  receiptNumber: string;
  issuedAt: string;
  amount: string | number;
  paymentMethod: string;
  paymentId: number;
  enrollmentId: number;
  studentName: string;
  courseName: string;
  levelName: string;
  note: string | null;
}

function parsePositiveId(
  value: string | string[] | undefined,
): number | null {
  if (Array.isArray(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizePayment(payment: ParentPaymentRow) {
  return {
    ...payment,
    amount: Number(payment.amount),
  };
}

export const parentPaymentRouter = Router();

parentPaymentRouter.use(
  authenticate,
  authorizeRoles("PARENT"),
);

parentPaymentRouter.get("/", async (_request, response, next) => {
  try {
    const authenticatedParent =
      response.locals.auth as AuthTokenPayload;
    const [payments] =
      await databasePool.execute<ParentPaymentRow[]>(
        `SELECT
           payments.id,
           payments.enrollment_id AS enrollmentId,
           payments.amount,
           payments.payment_method AS paymentMethod,
           payments.status,
           DATE_FORMAT(payments.due_date, '%Y-%m-%d') AS dueDate,
           DATE_FORMAT(payments.paid_at, '%Y-%m-%dT%H:%i:%s') AS paidAt,
           payments.note,
           DATE_FORMAT(payments.created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
           students.id AS studentId,
           students.first_name AS studentFirstName,
           students.last_name AS studentLastName,
           courses.name AS courseName,
           levels.name AS levelName,
           receipts.id AS receiptId,
           receipts.receipt_number AS receiptNumber
         FROM payments
         INNER JOIN enrollments ON enrollments.id = payments.enrollment_id
         INNER JOIN students ON students.id = enrollments.student_id
         INNER JOIN parents ON parents.id = students.parent_id
         INNER JOIN courses ON courses.id = enrollments.course_id
         INNER JOIN levels ON levels.id = enrollments.level_id
         LEFT JOIN receipts ON receipts.payment_id = payments.id
         WHERE parents.user_id = ?
         ORDER BY payments.id DESC`,
        [authenticatedParent.userId],
      );

    sendSuccess(
      response,
      200,
      "Payments retrieved successfully",
      payments.map(normalizePayment),
    );
  } catch (error) {
    next(error);
  }
});

parentPaymentRouter.get(
  "/proofs/:proofId/file",
  async (request, response, next) => {
    try {
      const proofId = parsePositiveId(request.params.proofId);
      if (proofId === null) {
        sendError(response, 400, "Proof ID must be a positive integer");
        return;
      }

      const authenticatedParent =
        response.locals.auth as AuthTokenPayload;
      const [proofs] =
        await databasePool.execute<ParentProofFileRow[]>(
          `SELECT
             payment_proofs.id,
             payment_proofs.stored_file_name AS storedFileName,
             payment_proofs.original_file_name AS originalFileName
           FROM payment_proofs
           INNER JOIN payments
             ON payments.id = payment_proofs.payment_id
           INNER JOIN enrollments
             ON enrollments.id = payments.enrollment_id
           INNER JOIN students
             ON students.id = enrollments.student_id
           INNER JOIN parents
             ON parents.id = students.parent_id
           WHERE payment_proofs.id = ?
             AND parents.user_id = ?
           LIMIT 1`,
          [proofId, authenticatedParent.userId],
        );
      const proof = proofs[0];
      if (proof === undefined) {
        sendError(response, 404, "Payment proof not found");
        return;
      }

      response.download(
        resolvePaymentProofPath(proof.storedFileName),
        proof.originalFileName,
        (error) => {
          if (error !== undefined && !response.headersSent) next(error);
        },
      );
    } catch (error) {
      next(error);
    }
  },
);

parentPaymentRouter.get(
  "/receipts/:receiptId/download",
  async (request, response, next) => {
    try {
      const receiptId = parsePositiveId(request.params.receiptId);
      if (receiptId === null) {
        sendError(response, 400, "Receipt ID must be a positive integer");
        return;
      }

      const authenticatedParent =
        response.locals.auth as AuthTokenPayload;
      const [receipts] =
        await databasePool.execute<ParentReceiptDownloadRow[]>(
          `SELECT
             receipts.receipt_number AS receiptNumber,
             DATE_FORMAT(receipts.issued_at, '%Y-%m-%d %H:%i:%s') AS issuedAt,
             receipts.amount,
             payments.payment_method AS paymentMethod,
             payments.id AS paymentId,
             enrollments.id AS enrollmentId,
             CONCAT(students.first_name, ' ', students.last_name) AS studentName,
             courses.name AS courseName,
             levels.name AS levelName,
             receipts.note
           FROM receipts
           INNER JOIN payments ON payments.id = receipts.payment_id
           INNER JOIN enrollments ON enrollments.id = payments.enrollment_id
           INNER JOIN students ON students.id = enrollments.student_id
           INNER JOIN parents ON parents.id = students.parent_id
           INNER JOIN courses ON courses.id = enrollments.course_id
           INNER JOIN levels ON levels.id = enrollments.level_id
           WHERE receipts.id = ?
             AND parents.user_id = ?
           LIMIT 1`,
          [receiptId, authenticatedParent.userId],
        );
      const receipt = receipts[0];
      if (receipt === undefined) {
        sendError(response, 404, "Receipt not found");
        return;
      }

      const pdf = await createReceiptPdf({
        ...receipt,
        amount: Number(receipt.amount),
      });
      response
        .status(200)
        .type("application/pdf")
        .setHeader(
          "Content-Disposition",
          `attachment; filename="${receipt.receiptNumber}.pdf"`,
        );
      response.send(pdf);
    } catch (error) {
      next(error);
    }
  },
);

parentPaymentRouter.get(
  "/:paymentId/qr",
  async (request, response, next) => {
    try {
      const paymentId = parsePositiveId(request.params.paymentId);
      if (paymentId === null) {
        sendError(response, 400, "Payment ID must be a positive integer");
        return;
      }

      const authenticatedParent =
        response.locals.auth as AuthTokenPayload;
      const [payments] =
        await databasePool.execute<OwnedPaymentRow[]>(
          `SELECT
             payments.id AS paymentId,
             payments.amount,
             payments.status
           FROM payments
           INNER JOIN enrollments
             ON enrollments.id = payments.enrollment_id
           INNER JOIN students
             ON students.id = enrollments.student_id
           INNER JOIN parents
             ON parents.id = students.parent_id
           WHERE payments.id = ?
             AND parents.user_id = ?
           LIMIT 1`,
          [paymentId, authenticatedParent.userId],
        );
      const payment = payments[0];
      if (payment === undefined) {
        sendError(response, 404, "Payment not found");
        return;
      }

      if (!["UNPAID", "REJECTED"].includes(payment.status)) {
        sendError(
          response,
          409,
          "QR code is only available for an unpaid or rejected payment",
        );
        return;
      }

      const amount = Number(payment.amount);
      if (amount <= 0) {
        sendError(
          response,
          409,
          "QR code requires a payment amount greater than zero",
        );
        return;
      }

      let promptPayId: string;

      try {
        promptPayId = getPromptPayId();
      } catch {
        sendError(
          response,
          503,
          "PromptPay is not configured",
        );
        return;
      }

      const payload = createPromptPayPayload(
        promptPayId,
        amount,
      );
      const image = await QRCode.toBuffer(payload, {
        type: "png",
        width: 512,
        margin: 2,
        errorCorrectionLevel: "M",
      });

      response
        .status(200)
        .type("image/png")
        .setHeader("Cache-Control", "no-store");
      response.send(image);
    } catch (error) {
      next(error);
    }
  },
);

parentPaymentRouter.post(
  "/:paymentId/proofs",
  paymentProofUpload,
  async (request, response, next) => {
    let storedFileName: string | null = null;

    try {
      const paymentId = parsePositiveId(request.params.paymentId);
      if (paymentId === null) {
        sendError(response, 400, "Payment ID must be a positive integer");
        return;
      }

      if (request.file === undefined) {
        sendError(
          response,
          400,
          "Payment proof file is required in field 'proof'",
        );
        return;
      }

      let inspectedProof;
      try {
        inspectedProof = await inspectPaymentProof(request.file);
      } catch (error) {
        if (
          error instanceof Error &&
          [
            "UNSUPPORTED_PAYMENT_PROOF_TYPE",
            "PAYMENT_PROOF_TYPE_MISMATCH",
          ].includes(error.message)
        ) {
          sendError(
            response,
            400,
            "Payment proof must be a genuine JPG, PNG, or PDF file with a matching extension and MIME type",
          );
          return;
        }
        throw error;
      }

      const authenticatedParent =
        response.locals.auth as AuthTokenPayload;
      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();
        const [payments] =
          await connection.execute<OwnedPaymentRow[]>(
            `SELECT
               payments.id AS paymentId,
               payments.amount,
               payments.status
             FROM payments
             INNER JOIN enrollments
               ON enrollments.id = payments.enrollment_id
             INNER JOIN students
               ON students.id = enrollments.student_id
             INNER JOIN parents
               ON parents.id = students.parent_id
             WHERE payments.id = ?
               AND parents.user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [paymentId, authenticatedParent.userId],
          );
        const payment = payments[0];

        if (payment === undefined) {
          await connection.rollback();
          sendError(response, 404, "Payment not found");
          return;
        }

        if (!["UNPAID", "REJECTED"].includes(payment.status)) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Proof can only be uploaded for an unpaid or rejected payment",
          );
          return;
        }

        storedFileName = await savePaymentProof(
          request.file.buffer,
          inspectedProof.extension,
        );
        const [result] =
          await connection.execute<ResultSetHeader>(
            `INSERT INTO payment_proofs (
               payment_id,
               uploaded_by_user_id,
               stored_file_name,
               original_file_name,
               mime_type,
               file_size_bytes,
               status
             ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
            [
              paymentId,
              authenticatedParent.userId,
              storedFileName,
              inspectedProof.originalFileName,
              inspectedProof.mimeType,
              inspectedProof.fileSizeBytes,
            ],
          );
        await connection.execute<ResultSetHeader>(
          `UPDATE payments
           SET payment_method = 'QR',
               status = 'PENDING_VERIFICATION',
               paid_at = NULL,
               verified_by_user_id = NULL,
               verified_at = NULL
           WHERE id = ?`,
          [paymentId],
        );
        await connection.commit();
        storedFileName = null;

        sendSuccess(response, 201, "Payment proof uploaded successfully", {
          proofId: result.insertId,
          paymentId,
          originalFileName: inspectedProof.originalFileName,
          mimeType: inspectedProof.mimeType,
          fileSizeBytes: inspectedProof.fileSizeBytes,
          proofStatus: "PENDING",
          paymentStatus: "PENDING_VERIFICATION",
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      if (storedFileName !== null) {
        try {
          await deletePaymentProofIfExists(storedFileName);
        } catch (cleanupError) {
          console.error(cleanupError);
        }
      }
      next(error);
    }
  },
);

parentPaymentRouter.get(
  "/:paymentId",
  async (request, response, next) => {
    try {
      const paymentId = parsePositiveId(request.params.paymentId);
      if (paymentId === null) {
        sendError(response, 400, "Payment ID must be a positive integer");
        return;
      }

      const authenticatedParent =
        response.locals.auth as AuthTokenPayload;
      const [payments] =
        await databasePool.execute<ParentPaymentRow[]>(
          `SELECT
             payments.id,
             payments.enrollment_id AS enrollmentId,
             payments.amount,
             payments.payment_method AS paymentMethod,
             payments.status,
             DATE_FORMAT(payments.due_date, '%Y-%m-%d') AS dueDate,
             DATE_FORMAT(payments.paid_at, '%Y-%m-%dT%H:%i:%s') AS paidAt,
             payments.note,
             DATE_FORMAT(payments.created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
             students.id AS studentId,
             students.first_name AS studentFirstName,
             students.last_name AS studentLastName,
             courses.name AS courseName,
             levels.name AS levelName,
             receipts.id AS receiptId,
             receipts.receipt_number AS receiptNumber
           FROM payments
           INNER JOIN enrollments ON enrollments.id = payments.enrollment_id
           INNER JOIN students ON students.id = enrollments.student_id
           INNER JOIN parents ON parents.id = students.parent_id
           INNER JOIN courses ON courses.id = enrollments.course_id
           INNER JOIN levels ON levels.id = enrollments.level_id
           LEFT JOIN receipts ON receipts.payment_id = payments.id
           WHERE payments.id = ?
             AND parents.user_id = ?
           LIMIT 1`,
          [paymentId, authenticatedParent.userId],
        );
      const payment = payments[0];
      if (payment === undefined) {
        sendError(response, 404, "Payment not found");
        return;
      }

      const [proofs] =
        await databasePool.execute<ParentProofRow[]>(
          `SELECT
             id,
             original_file_name AS originalFileName,
             mime_type AS mimeType,
             file_size_bytes AS fileSizeBytes,
             status,
             rejection_reason AS rejectionReason,
             DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt
           FROM payment_proofs
           WHERE payment_id = ?
           ORDER BY id DESC`,
          [paymentId],
        );
      const [receipts] =
        await databasePool.execute<ParentReceiptRow[]>(
          `SELECT
             id,
             receipt_number AS receiptNumber,
             amount,
             DATE_FORMAT(issued_at, '%Y-%m-%dT%H:%i:%s') AS issuedAt,
             note
           FROM receipts
           WHERE payment_id = ?
           LIMIT 1`,
          [paymentId],
        );

      sendSuccess(response, 200, "Payment retrieved successfully", {
        payment: normalizePayment(payment),
        proofs,
        receipt:
          receipts[0] === undefined
            ? null
            : {
                ...receipts[0],
                amount: Number(receipts[0].amount),
              },
      });
    } catch (error) {
      next(error);
    }
  },
);
