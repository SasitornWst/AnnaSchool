import { z } from "zod";

const optionalText = (maximumLength: number) =>
  z.string().trim().max(maximumLength).nullable().optional();

export const adminCreateTeacherSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(4)
      .max(50)
      .regex(/^\S+$/, "Username must not contain spaces"),

    title: optionalText(30),

    firstName: z.string().trim().min(1).max(100),

    lastName: z.string().trim().min(1).max(100),

    phone: optionalText(30),

    email: z.union([z.email().max(255), z.literal(""), z.null()]).optional(),

    biography: optionalText(5000),

    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const adminUpdateTeacherSchema = z
  .object({
    title: optionalText(30),

    firstName: z.string().trim().min(1).max(100).optional(),

    lastName: z.string().trim().min(1).max(100).optional(),

    phone: optionalText(30),

    email: z.union([z.email().max(255), z.literal(""), z.null()]).optional(),

    biography: optionalText(5000),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const adminUpdateTeacherStatusSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();
