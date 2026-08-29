import { z } from "zod";

const optionalText = (maximumLength: number) =>
  z.string().trim().max(maximumLength).nullable().optional();

const optionalAge = z
  .number()
  .int()
  .min(0)
  .max(120)
  .nullable()
  .optional();

export const adminCreateCourseSchema = z
  .object({
    name: z.string().trim().min(1).max(150),

    description: optionalText(10000),

    recommendedMinAge: optionalAge,

    recommendedMaxAge: optionalAge,

    price: z
      .number()
      .min(0)
      .max(99999999.99),

    totalMinutes: z
      .number()
      .int()
      .positive()
      .max(1000000),

    promotionText: optionalText(10000),

    imagePath: optionalText(500),

    isOpen: z.boolean().optional().default(true),
  })
  .strict()
  .refine(
    (data) =>
      data.recommendedMinAge == null ||
      data.recommendedMaxAge == null ||
      data.recommendedMinAge <= data.recommendedMaxAge,
    {
      path: ["recommendedMaxAge"],
      message:
        "Recommended maximum age must be greater than or equal to minimum age",
    },
  );

export const adminUpdateCourseSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .optional(),

    description: optionalText(10000),

    recommendedMinAge: optionalAge,

    recommendedMaxAge: optionalAge,

    price: z
      .number()
      .min(0)
      .max(99999999.99)
      .optional(),

    totalMinutes: z
      .number()
      .int()
      .positive()
      .max(1000000)
      .optional(),

    promotionText: optionalText(10000),

    imagePath: optionalText(500),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field is required",
    },
  )
  .refine(
    (data) =>
      data.recommendedMinAge == null ||
      data.recommendedMaxAge == null ||
      data.recommendedMinAge <= data.recommendedMaxAge,
    {
      path: ["recommendedMaxAge"],
      message:
        "Recommended maximum age must be greater than or equal to minimum age",
    },
  );

  export const adminUpdateCourseStatusSchema = z
  .object({
    isOpen: z.boolean(),
  })
  .strict();
