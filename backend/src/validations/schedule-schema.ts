import { z } from "zod";

export const scheduleStatusSchema = z.enum([
  "SCHEDULED",
  "RESCHEDULED",
  "COMPLETED",
  "CANCELLED",
]);

const timeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    "Time must use HH:mm format",
  );

const optionalText = (maximumLength: number) =>
  z.string().trim().max(maximumLength).nullable().optional();

export const adminCreateScheduleSchema = z
  .object({
    classId: z.number().int().positive(),

    teacherId: z.number().int().positive(),

    scheduledDate: z.iso.date(),

    startTime: timeSchema,

    endTime: timeSchema,

    status: scheduleStatusSchema
      .optional()
      .default("SCHEDULED"),

    location: optionalText(255),

    note: optionalText(5000),
  })
  .strict()
  .refine(
    (data) => data.endTime > data.startTime,
    {
      path: ["endTime"],
      message: "End time must be later than start time",
    },
  );

  export const adminUpdateScheduleSchema = z
  .object({
    teacherId: z
      .number()
      .int()
      .positive()
      .optional(),

    location: optionalText(255),

    note: optionalText(5000),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field is required",
    },
  );

export const adminRescheduleSchema = z
  .object({
    scheduledDate: z.iso.date(),

    startTime: timeSchema,

    endTime: timeSchema,

    teacherId: z
      .number()
      .int()
      .positive()
      .optional(),
  })
  .strict()
  .refine(
    (data) => data.endTime > data.startTime,
    {
      path: ["endTime"],
      message: "End time must be later than start time",
    },
  );

export const adminCancelScheduleSchema = z
  .object({
    note: optionalText(5000),
  })
  .strict();