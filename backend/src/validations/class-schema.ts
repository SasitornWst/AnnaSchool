import { z } from "zod";

export const classStatusSchema = z.enum([
  "PLANNED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

const optionalDate = z
  .iso
  .date()
  .nullable()
  .optional();

export const adminCreateClassSchema = z
  .object({
    courseId: z.number().int().positive(),

    levelId: z.number().int().positive(),

    primaryTeacherId: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional(),

    classCode: z
      .string()
      .trim()
      .min(1)
      .max(50),

    className: z
      .string()
      .trim()
      .min(1)
      .max(150),

    status: classStatusSchema
      .optional()
      .default("PLANNED"),

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

  export const adminAddClassMemberSchema = z
  .object({
    enrollmentId: z.number().int().positive(),
  })
  .strict();

  export const adminMoveClassMemberSchema = z
  .object({
    targetClassId: z.number().int().positive(),
  })
  .strict();