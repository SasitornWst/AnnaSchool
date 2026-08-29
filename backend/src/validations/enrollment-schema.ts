import { z } from "zod";

export const enrollmentStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

const optionalDate = z
  .iso
  .date()
  .nullable()
  .optional();

export const adminCreateEnrollmentSchema = z
  .object({
    studentId: z.number().int().positive(),

    courseId: z.number().int().positive(),

    levelId: z.number().int().positive(),

    applicationStudentId: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional(),

    allocatedMinutes: z
      .number()
      .int()
      .positive()
      .max(1000000),

    priceAtEnrollment: z
      .number()
      .min(0)
      .max(99999999.99),

    status: enrollmentStatusSchema
      .optional()
      .default("PENDING"),

    startDate: optionalDate,

    endDate: optionalDate,
  })
  .strict()
  .refine(
    (data) =>
      data.startDate == null ||
      data.endDate == null ||
      data.endDate >= data.startDate,
    {
      path: ["endDate"],
      message:
        "End date must be greater than or equal to start date",
    },
  );
