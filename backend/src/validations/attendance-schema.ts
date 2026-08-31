import { z } from "zod";

export const attendanceStatusSchema = z.enum([
  "PRESENT",
  "LATE",
  "ABSENT",
  "EXCUSED",
]);

const optionalNote = z
  .string()
  .trim()
  .max(5000)
  .nullable()
  .optional();

const attendanceItemSchema = z
  .object({
    classMemberId: z.number().int().positive(),

    status: attendanceStatusSchema,

    note: optionalNote,
  })
  .strict();

export const teacherSaveAttendancesSchema = z
  .object({
    attendances: z
      .array(attendanceItemSchema)
      .min(1, "At least one attendance is required"),
  })
  .strict()
  .superRefine((data, context) => {
    const memberIds = new Set<number>();

    data.attendances.forEach((attendance, index) => {
      if (memberIds.has(attendance.classMemberId)) {
        context.addIssue({
          code: "custom",
          path: [
            "attendances",
            index,
            "classMemberId",
          ],
          message:
            "Class member must not appear more than once",
        });
      }

      memberIds.add(attendance.classMemberId);
    });
  });