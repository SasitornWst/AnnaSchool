import { z } from "zod";

const optionalText = (maximumLength: number) =>
  z.string().trim().max(maximumLength).nullable().optional();

const localDateTimeSchema = z
  .iso
  .datetime({ local: true })
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:00$/,
    "Date and time must use YYYY-MM-DDTHH:mm:00 format",
  );

export const teacherCreateTeachingSessionSchema = z
  .object({
    scheduleId: z.number().int().positive(),

    startedAt: localDateTimeSchema,

    endedAt: localDateTimeSchema,

    lessonContent: optionalText(10000),

    progressNote: optionalText(10000),

    teacherNote: optionalText(10000),
  })
  .strict()
  .refine(
    (data) => data.endedAt > data.startedAt,
    {
      path: ["endedAt"],
      message: "End date and time must be later than start date and time",
    },
  );