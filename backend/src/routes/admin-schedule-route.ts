import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import {
  adminCancelScheduleSchema,
  adminCreateScheduleSchema,
  adminRescheduleSchema,
  adminUpdateScheduleSchema,
} from "../validations/schedule-schema.ts";

interface ClassRow extends RowDataPacket {
  id: number;
  status: string;
}

interface TeacherRow extends RowDataPacket {
  id: number;
}

interface ConflictingScheduleRow extends RowDataPacket {
  id: number;
}

interface AdminScheduleRow extends RowDataPacket {
  id: number;
  classId: number;
  classCode: string;
  className: string;
  teacherId: number;
  teacherFirstName: string;
  teacherLastName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: string;
  location: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CurrentScheduleRow extends RowDataPacket {
  id: number;
  classId: number;
  teacherId: number;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: string;
}

export const adminScheduleRouter = Router();

adminScheduleRouter.use(authenticate, authorizeRoles("ADMIN"));

adminScheduleRouter.post("/", async (request, response, next) => {
  try {
    const validationResult = adminCreateScheduleSchema.safeParse(request.body);

    if (!validationResult.success) {
      sendError(
        response,
        400,
        "Invalid schedule data",
        validationResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
      return;
    }

    const scheduleData = validationResult.data;
    const connection = await databasePool.getConnection();

    try {
      await connection.beginTransaction();

      const [classes] = await connection.execute<ClassRow[]>(
        `SELECT id, status
             FROM classes
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
        [scheduleData.classId],
      );

      const selectedClass = classes[0];

      if (selectedClass === undefined) {
        await connection.rollback();
        sendError(response, 400, "Class does not exist");
        return;
      }

      if (
        selectedClass.status === "COMPLETED" ||
        selectedClass.status === "CANCELLED"
      ) {
        await connection.rollback();

        sendError(
          response,
          409,
          "Cannot schedule a completed or cancelled class",
        );
        return;
      }

      const [teachers] = await connection.execute<TeacherRow[]>(
        `SELECT teachers.id
             FROM teachers
             INNER JOIN users
               ON users.id = teachers.user_id
             WHERE teachers.id = ?
               AND users.is_active = TRUE
             LIMIT 1
             FOR UPDATE`,
        [scheduleData.teacherId],
      );

      if (teachers[0] === undefined) {
        await connection.rollback();

        sendError(response, 400, "Active teacher does not exist");
        return;
      }

      const [teacherConflicts] = await connection.execute<
        ConflictingScheduleRow[]
      >(
        `SELECT id
             FROM schedules
             WHERE teacher_id = ?
               AND scheduled_date = ?
               AND status <> 'CANCELLED'
               AND start_time < ?
               AND end_time > ?
             LIMIT 1
             FOR UPDATE`,
        [
          scheduleData.teacherId,
          scheduleData.scheduledDate,
          scheduleData.endTime,
          scheduleData.startTime,
        ],
      );

      if (teacherConflicts[0] !== undefined) {
        await connection.rollback();

        sendError(
          response,
          409,
          "Teacher already has a schedule during this time",
        );
        return;
      }

      const [classConflicts] = await connection.execute<
        ConflictingScheduleRow[]
      >(
        `SELECT id
             FROM schedules
             WHERE class_id = ?
               AND scheduled_date = ?
               AND status <> 'CANCELLED'
               AND start_time < ?
               AND end_time > ?
             LIMIT 1
             FOR UPDATE`,
        [
          scheduleData.classId,
          scheduleData.scheduledDate,
          scheduleData.endTime,
          scheduleData.startTime,
        ],
      );

      if (classConflicts[0] !== undefined) {
        await connection.rollback();

        sendError(
          response,
          409,
          "Class already has a schedule during this time",
        );
        return;
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO schedules (
              class_id,
              teacher_id,
              scheduled_date,
              start_time,
              end_time,
              status,
              location,
              note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scheduleData.classId,
          scheduleData.teacherId,
          scheduleData.scheduledDate,
          scheduleData.startTime,
          scheduleData.endTime,
          scheduleData.status,
          scheduleData.location === "" ? null : (scheduleData.location ?? null),
          scheduleData.note === "" ? null : (scheduleData.note ?? null),
        ],
      );

      await connection.commit();

      sendSuccess(response, 201, "Schedule created successfully", {
        scheduleId: result.insertId,
        classId: scheduleData.classId,
        teacherId: scheduleData.teacherId,
        scheduledDate: scheduleData.scheduledDate,
        startTime: scheduleData.startTime,
        endTime: scheduleData.endTime,
        status: scheduleData.status,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

adminScheduleRouter.get("/", async (_request, response, next) => {
  try {
    const [schedules] = await databasePool.execute<AdminScheduleRow[]>(
      `SELECT
            schedules.id,
            classes.id AS classId,
            classes.class_code AS classCode,
            classes.class_name AS className,
            teachers.id AS teacherId,
            teachers.first_name AS teacherFirstName,
            teachers.last_name AS teacherLastName,
            DATE_FORMAT(
              schedules.scheduled_date,
              '%Y-%m-%d'
            ) AS scheduledDate,
            TIME_FORMAT(
              schedules.start_time,
              '%H:%i'
            ) AS startTime,
            TIME_FORMAT(
              schedules.end_time,
              '%H:%i'
            ) AS endTime,
            schedules.status,
            schedules.location,
            schedules.note,
            schedules.created_at AS createdAt,
            schedules.updated_at AS updatedAt
           FROM schedules
           INNER JOIN classes
             ON classes.id = schedules.class_id
           INNER JOIN teachers
             ON teachers.id = schedules.teacher_id
           ORDER BY
             schedules.scheduled_date ASC,
             schedules.start_time ASC,
             schedules.id ASC`,
    );

    sendSuccess(response, 200, "Schedules retrieved successfully", schedules);
  } catch (error) {
    next(error);
  }
});

adminScheduleRouter.get("/:scheduleId", async (request, response, next) => {
  try {
    const scheduleId = Number(request.params.scheduleId);

    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      sendError(response, 400, "Schedule ID must be a positive integer");
      return;
    }

    const [schedules] = await databasePool.execute<AdminScheduleRow[]>(
      `SELECT
            schedules.id,
            classes.id AS classId,
            classes.class_code AS classCode,
            classes.class_name AS className,
            teachers.id AS teacherId,
            teachers.first_name AS teacherFirstName,
            teachers.last_name AS teacherLastName,
            DATE_FORMAT(
              schedules.scheduled_date,
              '%Y-%m-%d'
            ) AS scheduledDate,
            TIME_FORMAT(
              schedules.start_time,
              '%H:%i'
            ) AS startTime,
            TIME_FORMAT(
              schedules.end_time,
              '%H:%i'
            ) AS endTime,
            schedules.status,
            schedules.location,
            schedules.note,
            schedules.created_at AS createdAt,
            schedules.updated_at AS updatedAt
           FROM schedules
           INNER JOIN classes
             ON classes.id = schedules.class_id
           INNER JOIN teachers
             ON teachers.id = schedules.teacher_id
           WHERE schedules.id = ?
           LIMIT 1`,
      [scheduleId],
    );

    const schedule = schedules[0];

    if (schedule === undefined) {
      sendError(response, 404, "Schedule not found");
      return;
    }

    sendSuccess(response, 200, "Schedule retrieved successfully", schedule);
  } catch (error) {
    next(error);
  }
});

adminScheduleRouter.patch(
  "/:scheduleId",
  async (request, response, next) => {
    try {
      const scheduleId =
        Number(request.params.scheduleId);

      if (
        !Number.isInteger(scheduleId) ||
        scheduleId <= 0
      ) {
        sendError(
          response,
          400,
          "Schedule ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminUpdateScheduleSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid schedule data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const scheduleData = validationResult.data;
      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [schedules] =
          await connection.execute<CurrentScheduleRow[]>(
            `SELECT
              id,
              class_id AS classId,
              teacher_id AS teacherId,
              DATE_FORMAT(
                scheduled_date,
                '%Y-%m-%d'
              ) AS scheduledDate,
              TIME_FORMAT(
                start_time,
                '%H:%i'
              ) AS startTime,
              TIME_FORMAT(
                end_time,
                '%H:%i'
              ) AS endTime,
              status
             FROM schedules
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [scheduleId],
          );

        const currentSchedule = schedules[0];

        if (currentSchedule === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Schedule not found",
          );
          return;
        }

        if (
          currentSchedule.status === "COMPLETED" ||
          currentSchedule.status === "CANCELLED"
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Cannot edit a completed or cancelled schedule",
          );
          return;
        }

        if (scheduleData.teacherId !== undefined) {
          const [teachers] =
            await connection.execute<TeacherRow[]>(
              `SELECT teachers.id
               FROM teachers
               INNER JOIN users
                 ON users.id = teachers.user_id
               WHERE teachers.id = ?
                 AND users.is_active = TRUE
               LIMIT 1
               FOR UPDATE`,
              [scheduleData.teacherId],
            );

          if (teachers[0] === undefined) {
            await connection.rollback();

            sendError(
              response,
              400,
              "Active teacher does not exist",
            );
            return;
          }

          const [teacherConflicts] =
            await connection.execute<
              ConflictingScheduleRow[]
            >(
              `SELECT id
               FROM schedules
               WHERE teacher_id = ?
                 AND scheduled_date = ?
                 AND status <> 'CANCELLED'
                 AND start_time < ?
                 AND end_time > ?
                 AND id <> ?
               LIMIT 1
               FOR UPDATE`,
              [
                scheduleData.teacherId,
                currentSchedule.scheduledDate,
                currentSchedule.endTime,
                currentSchedule.startTime,
                scheduleId,
              ],
            );

          if (teacherConflicts[0] !== undefined) {
            await connection.rollback();

            sendError(
              response,
              409,
              "Teacher already has a schedule during this time",
            );
            return;
          }
        }

        const updateFields: string[] = [];
        const updateValues:
          Array<string | number | null> = [];

        if (scheduleData.teacherId !== undefined) {
          updateFields.push("teacher_id = ?");
          updateValues.push(scheduleData.teacherId);
        }

        if ("location" in scheduleData) {
          updateFields.push("location = ?");
          updateValues.push(
            scheduleData.location === ""
              ? null
              : scheduleData.location ?? null,
          );
        }

        if ("note" in scheduleData) {
          updateFields.push("note = ?");
          updateValues.push(
            scheduleData.note === ""
              ? null
              : scheduleData.note ?? null,
          );
        }

        updateValues.push(scheduleId);

        await connection.execute<ResultSetHeader>(
          `UPDATE schedules
           SET ${updateFields.join(", ")}
           WHERE id = ?`,
          updateValues,
        );

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Schedule updated successfully",
          {
            scheduleId,
            updatedFields: Object.keys(scheduleData),
          },
        );
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  },
);

adminScheduleRouter.patch(
  "/:scheduleId/reschedule",
  async (request, response, next) => {
    try {
      const scheduleId =
        Number(request.params.scheduleId);

      if (
        !Number.isInteger(scheduleId) ||
        scheduleId <= 0
      ) {
        sendError(
          response,
          400,
          "Schedule ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminRescheduleSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid reschedule data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const rescheduleData = validationResult.data;
      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [schedules] =
          await connection.execute<CurrentScheduleRow[]>(
            `SELECT
              id,
              class_id AS classId,
              teacher_id AS teacherId,
              DATE_FORMAT(
                scheduled_date,
                '%Y-%m-%d'
              ) AS scheduledDate,
              TIME_FORMAT(
                start_time,
                '%H:%i'
              ) AS startTime,
              TIME_FORMAT(
                end_time,
                '%H:%i'
              ) AS endTime,
              status
             FROM schedules
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [scheduleId],
          );

        const currentSchedule = schedules[0];

        if (currentSchedule === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Schedule not found",
          );
          return;
        }

        if (
          currentSchedule.status === "COMPLETED" ||
          currentSchedule.status === "CANCELLED"
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Cannot reschedule a completed or cancelled schedule",
          );
          return;
        }

        const [classes] =
          await connection.execute<ClassRow[]>(
            `SELECT id, status
             FROM classes
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [currentSchedule.classId],
          );

        const selectedClass = classes[0];

        if (
          selectedClass === undefined ||
          selectedClass.status === "COMPLETED" ||
          selectedClass.status === "CANCELLED"
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Cannot reschedule into a completed or cancelled class",
          );
          return;
        }

        const selectedTeacherId =
          rescheduleData.teacherId ??
          currentSchedule.teacherId;

        const [teachers] =
          await connection.execute<TeacherRow[]>(
            `SELECT teachers.id
             FROM teachers
             INNER JOIN users
               ON users.id = teachers.user_id
             WHERE teachers.id = ?
               AND users.is_active = TRUE
             LIMIT 1
             FOR UPDATE`,
            [selectedTeacherId],
          );

        if (teachers[0] === undefined) {
          await connection.rollback();

          sendError(
            response,
            400,
            "Active teacher does not exist",
          );
          return;
        }

        const [teacherConflicts] =
          await connection.execute<
            ConflictingScheduleRow[]
          >(
            `SELECT id
             FROM schedules
             WHERE teacher_id = ?
               AND scheduled_date = ?
               AND status <> 'CANCELLED'
               AND start_time < ?
               AND end_time > ?
               AND id <> ?
             LIMIT 1
             FOR UPDATE`,
            [
              selectedTeacherId,
              rescheduleData.scheduledDate,
              rescheduleData.endTime,
              rescheduleData.startTime,
              scheduleId,
            ],
          );

        if (teacherConflicts[0] !== undefined) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Teacher already has a schedule during this time",
          );
          return;
        }

        const [classConflicts] =
          await connection.execute<
            ConflictingScheduleRow[]
          >(
            `SELECT id
             FROM schedules
             WHERE class_id = ?
               AND scheduled_date = ?
               AND status <> 'CANCELLED'
               AND start_time < ?
               AND end_time > ?
               AND id <> ?
             LIMIT 1
             FOR UPDATE`,
            [
              currentSchedule.classId,
              rescheduleData.scheduledDate,
              rescheduleData.endTime,
              rescheduleData.startTime,
              scheduleId,
            ],
          );

        if (classConflicts[0] !== undefined) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Class already has a schedule during this time",
          );
          return;
        }

        await connection.execute<ResultSetHeader>(
          `UPDATE schedules
           SET scheduled_date = ?,
               start_time = ?,
               end_time = ?,
               teacher_id = ?,
               status = 'RESCHEDULED'
           WHERE id = ?`,
          [
            rescheduleData.scheduledDate,
            rescheduleData.startTime,
            rescheduleData.endTime,
            selectedTeacherId,
            scheduleId,
          ],
        );

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Schedule rescheduled successfully",
          {
            scheduleId,
            classId: currentSchedule.classId,
            teacherId: selectedTeacherId,
            scheduledDate:
              rescheduleData.scheduledDate,
            startTime: rescheduleData.startTime,
            endTime: rescheduleData.endTime,
            status: "RESCHEDULED",
          },
        );
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  },
);

adminScheduleRouter.patch(
  "/:scheduleId/cancel",
  async (request, response, next) => {
    try {
      const scheduleId =
        Number(request.params.scheduleId);

      if (
        !Number.isInteger(scheduleId) ||
        scheduleId <= 0
      ) {
        sendError(
          response,
          400,
          "Schedule ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminCancelScheduleSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid cancellation data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const cancellationData = validationResult.data;
      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [schedules] =
          await connection.execute<CurrentScheduleRow[]>(
            `SELECT
              id,
              class_id AS classId,
              teacher_id AS teacherId,
              DATE_FORMAT(
                scheduled_date,
                '%Y-%m-%d'
              ) AS scheduledDate,
              TIME_FORMAT(
                start_time,
                '%H:%i'
              ) AS startTime,
              TIME_FORMAT(
                end_time,
                '%H:%i'
              ) AS endTime,
              status
             FROM schedules
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [scheduleId],
          );

        const currentSchedule = schedules[0];

        if (currentSchedule === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Schedule not found",
          );
          return;
        }

        if (currentSchedule.status === "CANCELLED") {
          await connection.rollback();

          sendError(
            response,
            409,
            "Schedule is already cancelled",
          );
          return;
        }

        if (currentSchedule.status === "COMPLETED") {
          await connection.rollback();

          sendError(
            response,
            409,
            "Completed schedule cannot be cancelled",
          );
          return;
        }

        if ("note" in cancellationData) {
          await connection.execute<ResultSetHeader>(
            `UPDATE schedules
             SET status = 'CANCELLED',
                 note = ?
             WHERE id = ?`,
            [
              cancellationData.note === ""
                ? null
                : cancellationData.note ?? null,
              scheduleId,
            ],
          );
        } else {
          await connection.execute<ResultSetHeader>(
            `UPDATE schedules
             SET status = 'CANCELLED'
             WHERE id = ?`,
            [scheduleId],
          );
        }

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Schedule cancelled successfully",
          {
            scheduleId,
            classId: currentSchedule.classId,
            teacherId: currentSchedule.teacherId,
            status: "CANCELLED",
          },
        );
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  },
);
