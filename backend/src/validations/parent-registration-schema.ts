import { z } from "zod";

const optionalText = (maximumLength: number) =>
  z.string().trim().max(maximumLength).nullable().optional();

export const parentRegistrationSchema = z
  .object({
    applicationId: z.number().int().positive(),

    username: z
      .string()
      .trim()
      .min(4)
      .max(50)
      .regex(/^\S+$/, "Username must not contain spaces"),

    password: z
      .string()
      .min(8)
      .refine(
        (password) => Buffer.byteLength(password, "utf8") <= 72,
        "Password must not exceed 72 bytes",
      ),

    parent: z
      .object({
        title: optionalText(30),
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        phone: z.string().trim().min(1).max(30),
        email: z
          .union([z.email().max(255), z.literal(""), z.null()])
          .optional(),
        lineId: optionalText(100),
        address: optionalText(5000),
      })
      .strict(),
  })
  .strict();

export type ParentRegistrationInput = z.infer<typeof parentRegistrationSchema>;

export const rejectParentRegistrationSchema = z
  .object({
    reason: z.string().trim().min(1).max(5000),
  })
  .strict();

export const adminCreateParentSchema = z
  .object({
    applicationId: z.number().int().positive(),

    username: z
      .string()
      .trim()
      .min(4)
      .max(50)
      .regex(/^\S+$/, "Username must not contain spaces"),
  })
  .strict();
