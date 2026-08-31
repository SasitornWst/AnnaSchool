import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(5000)
  .nullable()
  .optional();

const optionalDate = z
  .iso
  .date()
  .nullable()
  .optional();

export const adminCreatePaymentSchema = z
  .object({
    enrollmentId: z
      .number()
      .int()
      .positive(),

    amount: z
      .number()
      .nonnegative()
      .max(99_999_999.99)
      .refine(
        (value) =>
          Math.abs(
            value * 100 -
            Math.round(value * 100),
          ) < 0.00000001,
        "Amount must have no more than 2 decimal places",
      ),

    dueDate: optionalDate,

    note: optionalText,
  })
  .strict();

export const adminReviewPaymentProofSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),

    rejectionReason: z
      .string()
      .trim()
      .min(1)
      .max(5000)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((data, context) => {
    if (
      data.status === "REJECTED" &&
      (data.rejectionReason === undefined ||
        data.rejectionReason === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message:
          "Rejection reason is required when rejecting proof",
      });
    }

    if (
      data.status === "APPROVED" &&
      data.rejectionReason != null
    ) {
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message:
          "Rejection reason is only allowed when rejecting proof",
      });
    }
  });

export const adminRecordCashPaymentSchema = z
  .object({
    note: optionalText,
  })
  .strict();
