import { Router } from "express";
import type {
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import type { AuthTokenPayload } from "../utils/jwt.ts";
import { resolvePaymentProofPath } from "../utils/payment-proof-storage.ts";
import { createReceiptPdf } from "../utils/receipt-pdf.ts";
import { issueReceipt } from "../utils/receipt-number.ts";
import {
  adminCreatePaymentSchema,
  adminRecordCashPaymentSchema,
  adminReviewPaymentProofSchema,
} from "../validations/payment-schema.ts";

interface EnrollmentRow extends RowDataPacket {
  id: number;
  status: string;
}

interface PaymentRow extends RowDataPacket {
  id: number;
  enrollmentId: number;
  amount: string | number;
  paymentMethod: string | null;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  verifiedByUserId: number | null;
  verifiedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  studentId: number;
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  levelName: string;
}

interface ProofRow extends RowDataPacket {
  id: number;
  paymentId: number;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: string;
  uploadedByUserId: number;
  reviewedByUserId: number | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface ProofFileRow extends RowDataPacket {
  id: number;
  storedFileName: string;
  originalFileName: string;
}

interface ReviewProofRow extends RowDataPacket {
  proofId: number;
  proofStatus: string;
  paymentId: number;
  paymentStatus: string;
  amount: string | number;
}

interface CashPaymentRow extends RowDataPacket {
  paymentId: number;
  status: string;
  amount: string | number;
}

interface ReceiptRow extends RowDataPacket {
  id: number;
  paymentId: number;
  receiptNumber: string;
  amount: string | number;
  issuedAt: string;
  note: string | null;
}

interface ReceiptDownloadRow extends RowDataPacket {
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

function parsePositiveId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function paymentData(payment: PaymentRow) {
  return {
    ...payment,
    amount: Number(payment.amount),
  };
}

export const adminPaymentRouter = Router();

adminPaymentRouter.use(
  authenticate,
  authorizeRoles("ADMIN"),
);

adminPaymentRouter.post("/", async (request, response, next) => {
  try {
    const validationResult =
      adminCreatePaymentSchema.safeParse(request.body);

    if (!validationResult.success) {
      sendError(
        response,
        400,
        "Invalid payment data",
        validationResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
      return;
    }

    const data = validationResult.data;
    const connection = await databasePool.getConnection();

    try {
      await connection.beginTransaction();
      const [enrollments] =
        await connection.execute<EnrollmentRow[]>(
          `SELECT id, status
           FROM enrollments
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [data.enrollmentId],
        );
      const enrollment = enrollments[0];

      if (enrollment === undefined) {
        await connection.rollback();
        sendError(response, 404, "Enrollment not found");
        return;
      }

      if (enrollment.status === "CANCELLED") {
        await connection.rollback();
        sendError(
          response,
          409,
          "Cannot create a payment for a cancelled enrollment",
        );
        return;
      }

      const [result] =
        await connection.execute<ResultSetHeader>(
          `INSERT INTO payments (
             enrollment_id,
             amount,
             payment_method,
             status,
             due_date,
             paid_at,
             verified_by_user_id,
             verified_at,
             note
           ) VALUES (?, ?, NULL, 'UNPAID', ?, NULL, NULL, NULL, ?)`,
          [
            data.enrollmentId,
            data.amount,
            data.dueDate ?? null,
            data.note === "" ? null : data.note ?? null,
          ],
        );

      await connection.commit();
      sendSuccess(
        response,
        201,
        "Payment created successfully",
        {
          paymentId: result.insertId,
          enrollmentId: data.enrollmentId,
          amount: data.amount,
          paymentMethod: null,
          status: "UNPAID",
          dueDate: data.dueDate ?? null,
        },
      );
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

adminPaymentRouter.get("/", async (_request, response, next) => {
  try {
    const [payments] = await databasePool.execute<PaymentRow[]>(
      `SELECT
         payments.id,
         payments.enrollment_id AS enrollmentId,
         payments.amount,
         payments.payment_method AS paymentMethod,
         payments.status,
         DATE_FORMAT(payments.due_date, '%Y-%m-%d') AS dueDate,
         DATE_FORMAT(payments.paid_at, '%Y-%m-%dT%H:%i:%s') AS paidAt,
         payments.verified_by_user_id AS verifiedByUserId,
         DATE_FORMAT(payments.verified_at, '%Y-%m-%dT%H:%i:%s') AS verifiedAt,
         payments.note,
         DATE_FORMAT(payments.created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
         DATE_FORMAT(payments.updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt,
         students.id AS studentId,
         students.first_name AS studentFirstName,
         students.last_name AS studentLastName,
         courses.name AS courseName,
         levels.name AS levelName
       FROM payments
       INNER JOIN enrollments ON enrollments.id = payments.enrollment_id
       INNER JOIN students ON students.id = enrollments.student_id
       INNER JOIN courses ON courses.id = enrollments.course_id
       INNER JOIN levels ON levels.id = enrollments.level_id
       ORDER BY payments.id DESC`,
    );

    sendSuccess(
      response,
      200,
      "Payments retrieved successfully",
      payments.map(paymentData),
    );
  } catch (error) {
    next(error);
  }
});

adminPaymentRouter.get(
  "/proofs/:proofId/file",
  async (request, response, next) => {
    try {
      const proofId = parsePositiveId(request.params.proofId);
      if (proofId === null) {
        sendError(response, 400, "Proof ID must be a positive integer");
        return;
      }

      const [proofs] = await databasePool.execute<ProofFileRow[]>(
        `SELECT id,
                stored_file_name AS storedFileName,
                original_file_name AS originalFileName
         FROM payment_proofs
         WHERE id = ?
         LIMIT 1`,
        [proofId],
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

adminPaymentRouter.patch(
  "/proofs/:proofId/review",
  async (request, response, next) => {
    try {
      const proofId = parsePositiveId(request.params.proofId);
      if (proofId === null) {
        sendError(response, 400, "Proof ID must be a positive integer");
        return;
      }

      const validationResult =
        adminReviewPaymentProofSchema.safeParse(request.body);
      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid proof review data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const authenticatedAdmin =
        response.locals.auth as AuthTokenPayload;
      const review = validationResult.data;
      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();
        const [proofs] =
          await connection.execute<ReviewProofRow[]>(
            `SELECT
               payment_proofs.id AS proofId,
               payment_proofs.status AS proofStatus,
               payments.id AS paymentId,
               payments.status AS paymentStatus,
               payments.amount
             FROM payment_proofs
             INNER JOIN payments
               ON payments.id = payment_proofs.payment_id
             WHERE payment_proofs.id = ?
             LIMIT 1
             FOR UPDATE`,
            [proofId],
          );
        const proof = proofs[0];

        if (proof === undefined) {
          await connection.rollback();
          sendError(response, 404, "Payment proof not found");
          return;
        }

        if (proof.proofStatus !== "PENDING") {
          await connection.rollback();
          sendError(response, 409, "Payment proof has already been reviewed");
          return;
        }

        if (proof.paymentStatus !== "PENDING_VERIFICATION") {
          await connection.rollback();
          sendError(response, 409, "Payment is not awaiting verification");
          return;
        }

        if (review.status === "REJECTED") {
          const rejectionReason = review.rejectionReason;

          if (typeof rejectionReason !== "string") {
            throw new Error(
              "Validated rejection reason is missing",
            );
          }

          await connection.execute(
            `UPDATE payment_proofs
             SET status = 'REJECTED',
                 reviewed_by_user_id = ?,
                 reviewed_at = CURRENT_TIMESTAMP,
                 rejection_reason = ?
             WHERE id = ?`,
            [
              authenticatedAdmin.userId,
              rejectionReason,
              proofId,
            ],
          );
          await connection.execute<ResultSetHeader>(
            `UPDATE payments
             SET status = 'REJECTED',
                 verified_by_user_id = ?,
                 verified_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [authenticatedAdmin.userId, proof.paymentId],
          );
          await connection.commit();
          sendSuccess(response, 200, "Payment proof rejected", {
            proofId,
            paymentId: proof.paymentId,
            proofStatus: "REJECTED",
            paymentStatus: "REJECTED",
          });
          return;
        }

        await connection.execute<ResultSetHeader>(
          `UPDATE payment_proofs
           SET status = 'APPROVED',
               reviewed_by_user_id = ?,
               reviewed_at = CURRENT_TIMESTAMP,
               rejection_reason = NULL
           WHERE id = ?`,
          [authenticatedAdmin.userId, proofId],
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE payments
           SET payment_method = 'QR',
               status = 'PAID',
               paid_at = CURRENT_TIMESTAMP,
               verified_by_user_id = ?,
               verified_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [authenticatedAdmin.userId, proof.paymentId],
        );
        const receipt = await issueReceipt(
          connection,
          proof.paymentId,
          Number(proof.amount),
          authenticatedAdmin.userId,
          `Approved payment proof #${proofId}`,
        );
        await connection.commit();

        sendSuccess(response, 200, "Payment proof approved", {
          proofId,
          paymentId: proof.paymentId,
          proofStatus: "APPROVED",
          paymentStatus: "PAID",
          receipt,
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  },
);

adminPaymentRouter.get(
  "/receipts/:receiptId/download",
  async (request, response, next) => {
    try {
      const receiptId = parsePositiveId(request.params.receiptId);
      if (receiptId === null) {
        sendError(response, 400, "Receipt ID must be a positive integer");
        return;
      }

      const [receipts] =
        await databasePool.execute<ReceiptDownloadRow[]>(
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
           INNER JOIN courses ON courses.id = enrollments.course_id
           INNER JOIN levels ON levels.id = enrollments.level_id
           WHERE receipts.id = ?
           LIMIT 1`,
          [receiptId],
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

adminPaymentRouter.post(
  "/:paymentId/cash",
  async (request, response, next) => {
    try {
      const paymentId = parsePositiveId(request.params.paymentId);
      if (paymentId === null) {
        sendError(response, 400, "Payment ID must be a positive integer");
        return;
      }

      const validationResult =
        adminRecordCashPaymentSchema.safeParse(request.body);
      if (!validationResult.success) {
        sendError(response, 400, "Invalid cash payment data");
        return;
      }

      const authenticatedAdmin =
        response.locals.auth as AuthTokenPayload;
      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();
        const [payments] =
          await connection.execute<CashPaymentRow[]>(
            `SELECT id AS paymentId, status, amount
             FROM payments
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [paymentId],
          );
        const payment = payments[0];

        if (payment === undefined) {
          await connection.rollback();
          sendError(response, 404, "Payment not found");
          return;
        }

        if (!['UNPAID', 'REJECTED'].includes(payment.status)) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Only an unpaid or rejected payment can be recorded as cash",
          );
          return;
        }

        const note = validationResult.data.note;
        await connection.execute<ResultSetHeader>(
          `UPDATE payments
           SET payment_method = 'CASH',
               status = 'PAID',
               paid_at = CURRENT_TIMESTAMP,
               verified_by_user_id = ?,
               verified_at = CURRENT_TIMESTAMP,
               note = COALESCE(?, note)
           WHERE id = ?`,
          [
            authenticatedAdmin.userId,
            note === "" ? null : note ?? null,
            paymentId,
          ],
        );
        const receipt = await issueReceipt(
          connection,
          paymentId,
          Number(payment.amount),
          authenticatedAdmin.userId,
          note === "" ? null : note ?? null,
        );
        await connection.commit();

        sendSuccess(response, 200, "Cash payment recorded successfully", {
          paymentId,
          paymentMethod: "CASH",
          status: "PAID",
          receipt,
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  },
);

adminPaymentRouter.get(
  "/:paymentId",
  async (request, response, next) => {
    try {
      const paymentId = parsePositiveId(request.params.paymentId);
      if (paymentId === null) {
        sendError(response, 400, "Payment ID must be a positive integer");
        return;
      }

      const [payments] = await databasePool.execute<PaymentRow[]>(
        `SELECT
           payments.id,
           payments.enrollment_id AS enrollmentId,
           payments.amount,
           payments.payment_method AS paymentMethod,
           payments.status,
           DATE_FORMAT(payments.due_date, '%Y-%m-%d') AS dueDate,
           DATE_FORMAT(payments.paid_at, '%Y-%m-%dT%H:%i:%s') AS paidAt,
           payments.verified_by_user_id AS verifiedByUserId,
           DATE_FORMAT(payments.verified_at, '%Y-%m-%dT%H:%i:%s') AS verifiedAt,
           payments.note,
           DATE_FORMAT(payments.created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
           DATE_FORMAT(payments.updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt,
           students.id AS studentId,
           students.first_name AS studentFirstName,
           students.last_name AS studentLastName,
           courses.name AS courseName,
           levels.name AS levelName
         FROM payments
         INNER JOIN enrollments ON enrollments.id = payments.enrollment_id
         INNER JOIN students ON students.id = enrollments.student_id
         INNER JOIN courses ON courses.id = enrollments.course_id
         INNER JOIN levels ON levels.id = enrollments.level_id
         WHERE payments.id = ?
         LIMIT 1`,
        [paymentId],
      );
      const payment = payments[0];
      if (payment === undefined) {
        sendError(response, 404, "Payment not found");
        return;
      }

      const [proofs] = await databasePool.execute<ProofRow[]>(
        `SELECT
           id,
           payment_id AS paymentId,
           original_file_name AS originalFileName,
           mime_type AS mimeType,
           file_size_bytes AS fileSizeBytes,
           status,
           uploaded_by_user_id AS uploadedByUserId,
           reviewed_by_user_id AS reviewedByUserId,
           DATE_FORMAT(reviewed_at, '%Y-%m-%dT%H:%i:%s') AS reviewedAt,
           rejection_reason AS rejectionReason,
           DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt
         FROM payment_proofs
         WHERE payment_id = ?
         ORDER BY id DESC`,
        [paymentId],
      );
      const [receipts] = await databasePool.execute<ReceiptRow[]>(
        `SELECT
           id,
           payment_id AS paymentId,
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
        payment: paymentData(payment),
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
