import { z } from "zod";

const optionalDescription = z
  .string()
  .trim()
  .max(10000)
  .nullable()
  .optional();

export const adminCreateLevelSchema = z
  .object({
    name: z.string().trim().min(1).max(100),

    description: optionalDescription,

    sortOrder: z
      .number()
      .int()
      .min(0)
      .max(1000000)
      .optional()
      .default(0),

    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const adminUpdateLevelSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    description: optionalDescription,

    sortOrder: z
      .number()
      .int()
      .min(0)
      .max(1000000)
      .optional(),

    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field is required",
    },
  );