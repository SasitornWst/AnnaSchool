import { z } from "zod";

const optionalText = (maximumLength: number) =>
  z.string().trim().max(maximumLength).nullable().optional();

const applicationStudentSchema = z
  .object({
    title: optionalText(30),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    nickname: optionalText(100),
    birthDate: z.iso.date(),
    schoolName: optionalText(255),
    medicalCondition: optionalText(5000),
    interestedCourseId: z.number().int().positive().nullable().optional(),
  })
  .strict();

export const createApplicationSchema = z
  .object({
    parent: z
      .object({
        title: optionalText(30),
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        phone: z.string().trim().min(1).max(30),
        email: z
          .union([
            z.email().max(255),
            z.literal(""),
            z.null(),
          ])
          .optional(),
        lineId: optionalText(100),
        address: optionalText(5000),
      })
      .strict(),

    students: z
      .array(applicationStudentSchema)
      .min(1, "At least one student is required"),
  })
  .strict();

export type CreateApplicationInput =
  z.infer<typeof createApplicationSchema>;

export const applicationStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "ASSESSED",
  "APPROVED",
  "REJECTED",
]);

export type ApplicationStatus =
  z.infer<typeof applicationStatusSchema>;

export const updateApplicationStatusSchema = z
  .object({
    status: applicationStatusSchema,
    adminNote: optionalText(5000),
  })
  .strict();

export const updateStudentAssessmentSchema = z
  .object({
    assessedLevelId: z.number().int().positive(),
    assessmentNote: optionalText(5000),
  })
  .strict();