import { Router } from "express";
import type {
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import {
  sendError,
  sendSuccess,
} from "../utils/api-response.ts";
import type {
  AuthTokenPayload,
} from "../utils/jwt.ts";
import {
  teacherSaveAttendancesSchema,
} from "../validations/attendance-schema.ts";
import {
  teacherCreateTeachingSessionSchema,
} from "../validations/teaching-session-schema.ts";

interface TeacherProfileRow extends RowDataPacket {
  teacherId: number;
  userId: number;
  username: string;
  isActive: number;
  title: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  biography: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TeacherIdentityRow extends RowDataPacket {
  teacherId: number;
  isActive: number;
}

interface TeacherScheduleRow extends RowDataPacket {
  id: number;
  classId: number;
  classCode: string;
  className: string;
  courseId: number;
  courseName: string;
  levelId: number;
  levelName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: string;
  location: string | null;
  note: string | null;
}

interface TeachingScheduleRow extends RowDataPacket {
  id: number;
  classId: number;
  teacherId: number;
  scheduledDate: string;
  status: string;
}

interface ExistingTeachingSessionRow extends RowDataPacket {
  id: number;
}

interface TeachingSessionForAttendanceRow
  extends RowDataPacket {
  id: number;
  classId: number;
  teacherId: number;
  status: string;
}

interface ClassMemberForAttendanceRow
  extends RowDataPacket {
  id: number;
}

interface FinalizeTeachingSessionRow
  extends RowDataPacket {
  id: number;
  scheduleId: number;
  classId: number;
  teacherId: number;
  actualMinutes: number;
  sessionStatus: string;
  scheduleStatus: string;
}

interface FinalizeClassMemberRow
  extends RowDataPacket {
  classMemberId: number;
  enrollmentId: number;
  enrollmentStatus: string;
  allocatedMinutes: number;
}

interface FinalizeAttendanceRow
  extends RowDataPacket {
  classMemberId: number;
}

interface EnrollmentUsedMinutesRow
  extends RowDataPacket {
  enrollmentId: number;
  usedMinutes: string | number;
}

function localDateTimeToMinutes(value: string): number {
  const [datePart, timePart] = value.split("T");

  if (datePart === undefined || timePart === undefined) {
    throw new Error("Invalid local date and time");
  }

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error("Invalid local date and time");
  }

  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

export const teacherRouter = Router();

teacherRouter.use(
  authenticate,
  authorizeRoles("TEACHER"),
);

teacherRouter.get(
  "/me",
  async (_request, response, next) => {
    try {
      const authenticatedTeacher =
        response.locals.auth as AuthTokenPayload;

      const [teachers] =
        await databasePool.execute<TeacherProfileRow[]>(
          `SELECT
            teachers.id AS teacherId,
            users.id AS userId,
            users.username,
            users.is_active AS isActive,
            teachers.title,
            teachers.first_name AS firstName,
            teachers.last_name AS lastName,
            teachers.phone,
            teachers.email,
            teachers.biography,
            teachers.created_at AS createdAt,
            teachers.updated_at AS updatedAt
           FROM teachers
           INNER JOIN users
             ON users.id = teachers.user_id
           WHERE teachers.user_id = ?
           LIMIT 1`,
          [authenticatedTeacher.userId],
        );

      const teacher = teachers[0];

      if (teacher === undefined) {
        sendError(response, 404, "Teacher profile not found");
        return;
      }

      if (teacher.isActive !== 1) {
        sendError(response, 403, "Teacher account is inactive");
        return;
      }

      sendSuccess(
        response,
        200,
        "Teacher profile retrieved successfully",
        {
          ...teacher,
          isActive: true,
        },
      );
    } catch (error) {
      next(error);
    }
  },
);

teacherRouter.post(
  "/teaching-sessions",
  async (request, response, next) => {
    try {
      const validationResult =
        teacherCreateTeachingSessionSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid teaching session data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const sessionData = validationResult.data;
      const authenticatedTeacher =
        response.locals.auth as AuthTokenPayload;

      const startedAtMinutes = localDateTimeToMinutes(
        sessionData.startedAt,
      );
      const endedAtMinutes = localDateTimeToMinutes(
        sessionData.endedAt,
      );
      const actualMinutes = endedAtMinutes - startedAtMinutes;

      if (!Number.isInteger(actualMinutes) || actualMinutes <= 0) {
        sendError(
          response,
          400,
          "Actual teaching duration must be a positive whole number of minutes",
        );
        return;
      }

      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [teachers] =
          await connection.execute<TeacherIdentityRow[]>(
            `SELECT
              teachers.id AS teacherId,
              users.is_active AS isActive
             FROM teachers
             INNER JOIN users
               ON users.id = teachers.user_id
             WHERE teachers.user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [authenticatedTeacher.userId],
          );

        const teacher = teachers[0];

        if (teacher === undefined) {
          await connection.rollback();
          sendError(response, 404, "Teacher profile not found");
          return;
        }

        if (teacher.isActive !== 1) {
          await connection.rollback();
          sendError(response, 403, "Teacher account is inactive");
          return;
        }

        const [schedules] =
          await connection.execute<TeachingScheduleRow[]>(
            `SELECT
              id,
              class_id AS classId,
              teacher_id AS teacherId,
              DATE_FORMAT(
                scheduled_date,
                '%Y-%m-%d'
              ) AS scheduledDate,
              status
             FROM schedules
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [sessionData.scheduleId],
          );

        const schedule = schedules[0];

        if (schedule === undefined) {
          await connection.rollback();
          sendError(response, 404, "Schedule not found");
          return;
        }

        if (schedule.teacherId !== teacher.teacherId) {
          await connection.rollback();
          sendError(
            response,
            403,
            "Schedule is not assigned to this teacher",
          );
          return;
        }

        if (
          schedule.status === "COMPLETED" ||
          schedule.status === "CANCELLED"
        ) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Cannot open a teaching session for a completed or cancelled schedule",
          );
          return;
        }

        if (
          sessionData.startedAt.slice(0, 10) !==
          schedule.scheduledDate
        ) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Teaching session date must match the schedule date",
          );
          return;
        }

        const [existingSessions] =
          await connection.execute<ExistingTeachingSessionRow[]>(
            `SELECT id
             FROM teaching_sessions
             WHERE schedule_id = ?
             LIMIT 1
             FOR UPDATE`,
            [sessionData.scheduleId],
          );

        if (existingSessions[0] !== undefined) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Schedule already has a teaching session",
          );
          return;
        }

        const [result] =
          await connection.execute<ResultSetHeader>(
            `INSERT INTO teaching_sessions (
              schedule_id,
              teacher_id,
              started_at,
              ended_at,
              actual_minutes,
              lesson_content,
              progress_note,
              teacher_note,
              status,
              finalized_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NULL)`,
            [
              sessionData.scheduleId,
              teacher.teacherId,
              sessionData.startedAt.replace("T", " "),
              sessionData.endedAt.replace("T", " "),
              actualMinutes,
              sessionData.lessonContent === ""
                ? null
                : sessionData.lessonContent ?? null,
              sessionData.progressNote === ""
                ? null
                : sessionData.progressNote ?? null,
              sessionData.teacherNote === ""
                ? null
                : sessionData.teacherNote ?? null,
            ],
          );

        await connection.commit();

        sendSuccess(
          response,
          201,
          "Teaching session created successfully",
          {
            teachingSessionId: result.insertId,
            scheduleId: sessionData.scheduleId,
            classId: schedule.classId,
            teacherId: teacher.teacherId,
            startedAt: sessionData.startedAt,
            endedAt: sessionData.endedAt,
            actualMinutes,
            status: "DRAFT",
          },
        );
      } catch (error) {
        await connection.rollback();

        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ER_DUP_ENTRY"
        ) {
          sendError(
            response,
            409,
            "Schedule already has a teaching session",
          );
          return;
        }

        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  },
);

teacherRouter.get(
  "/schedules",
  async (_request, response, next) => {
    try {
      const authenticatedTeacher =
        response.locals.auth as AuthTokenPayload;

      const [teachers] =
        await databasePool.execute<TeacherIdentityRow[]>(
          `SELECT
            teachers.id AS teacherId,
            users.is_active AS isActive
           FROM teachers
           INNER JOIN users
             ON users.id = teachers.user_id
           WHERE teachers.user_id = ?
           LIMIT 1`,
          [authenticatedTeacher.userId],
        );

      const teacher = teachers[0];

      if (teacher === undefined) {
        sendError(response, 404, "Teacher profile not found");
        return;
      }

      if (teacher.isActive !== 1) {
        sendError(response, 403, "Teacher account is inactive");
        return;
      }

      const [schedules] =
        await databasePool.execute<TeacherScheduleRow[]>(
          `SELECT
            schedules.id,
            classes.id AS classId,
            classes.class_code AS classCode,
            classes.class_name AS className,
            courses.id AS courseId,
            courses.name AS courseName,
            levels.id AS levelId,
            levels.name AS levelName,
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
            schedules.note
           FROM schedules
           INNER JOIN classes
             ON classes.id = schedules.class_id
           INNER JOIN courses
             ON courses.id = classes.course_id
           INNER JOIN levels
             ON levels.id = classes.level_id
           WHERE schedules.teacher_id = ?
           ORDER BY
             schedules.scheduled_date ASC,
             schedules.start_time ASC,
             schedules.id ASC`,
          [teacher.teacherId],
        );

      sendSuccess(
        response,
        200,
        "Teacher schedules retrieved successfully",
        schedules,
      );
    } catch (error) {
      next(error);
    }
  },
);

teacherRouter.put(
  "/teaching-sessions/:teachingSessionId/attendances",
  async (request, response, next) => {
    try {
      const teachingSessionId = Number(
        request.params.teachingSessionId,
      );

      if (
        !Number.isInteger(teachingSessionId) ||
        teachingSessionId <= 0
      ) {
        sendError(
          response,
          400,
          "Teaching session ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        teacherSaveAttendancesSchema.safeParse(
          request.body,
        );

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid attendance data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { attendances } = validationResult.data;
      const authenticatedTeacher =
        response.locals.auth as AuthTokenPayload;

      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [teachers] =
          await connection.execute<TeacherIdentityRow[]>(
            `SELECT
              teachers.id AS teacherId,
              users.is_active AS isActive
             FROM teachers
             INNER JOIN users
               ON users.id = teachers.user_id
             WHERE teachers.user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [authenticatedTeacher.userId],
          );

        const teacher = teachers[0];

        if (teacher === undefined) {
          await connection.rollback();
          sendError(response, 404, "Teacher profile not found");
          return;
        }

        if (teacher.isActive !== 1) {
          await connection.rollback();
          sendError(response, 403, "Teacher account is inactive");
          return;
        }

        const [sessions] =
          await connection.execute<
            TeachingSessionForAttendanceRow[]
          >(
            `SELECT
              teaching_sessions.id,
              schedules.class_id AS classId,
              teaching_sessions.teacher_id AS teacherId,
              teaching_sessions.status
             FROM teaching_sessions
             INNER JOIN schedules
               ON schedules.id = teaching_sessions.schedule_id
             WHERE teaching_sessions.id = ?
             LIMIT 1
             FOR UPDATE`,
            [teachingSessionId],
          );

        const teachingSession = sessions[0];

        if (teachingSession === undefined) {
          await connection.rollback();
          sendError(response, 404, "Teaching session not found");
          return;
        }

        if (teachingSession.teacherId !== teacher.teacherId) {
          await connection.rollback();
          sendError(
            response,
            403,
            "Teaching session does not belong to this teacher",
          );
          return;
        }

        if (teachingSession.status !== "DRAFT") {
          await connection.rollback();
          sendError(
            response,
            409,
            "Attendance can only be changed while the teaching session is DRAFT",
          );
          return;
        }

        const classMemberIds = attendances.map(
          (attendance) => attendance.classMemberId,
        );
        const memberPlaceholders = classMemberIds
          .map(() => "?")
          .join(", ");

        const [classMembers] =
          await connection.execute<
            ClassMemberForAttendanceRow[]
          >(
            `SELECT id
             FROM class_members
             WHERE class_id = ?
               AND status = 'ACTIVE'
               AND id IN (${memberPlaceholders})
             FOR UPDATE`,
            [teachingSession.classId, ...classMemberIds],
          );

        if (classMembers.length !== classMemberIds.length) {
          await connection.rollback();
          sendError(
            response,
            400,
            "One or more class members do not belong to this active class",
          );
          return;
        }

        for (const attendance of attendances) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO attendances (
              teaching_session_id,
              class_member_id,
              status,
              note
            )
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              status = VALUES(status),
              note = VALUES(note)`,
            [
              teachingSessionId,
              attendance.classMemberId,
              attendance.status,
              attendance.note === ""
                ? null
                : attendance.note ?? null,
            ],
          );
        }

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Attendances saved successfully",
          {
            teachingSessionId,
            savedCount: attendances.length,
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

teacherRouter.patch(
  "/teaching-sessions/:teachingSessionId/finalize",
  async (request, response, next) => {
    try {
      const teachingSessionId = Number(
        request.params.teachingSessionId,
      );

      if (
        !Number.isInteger(teachingSessionId) ||
        teachingSessionId <= 0
      ) {
        sendError(
          response,
          400,
          "Teaching session ID must be a positive integer",
        );
        return;
      }

      const authenticatedTeacher =
        response.locals.auth as AuthTokenPayload;

      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [teachers] =
          await connection.execute<TeacherIdentityRow[]>(
            `SELECT
              teachers.id AS teacherId,
              users.is_active AS isActive
             FROM teachers
             INNER JOIN users
               ON users.id = teachers.user_id
             WHERE teachers.user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [authenticatedTeacher.userId],
          );

        const teacher = teachers[0];

        if (teacher === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Teacher profile not found",
          );
          return;
        }

        if (teacher.isActive !== 1) {
          await connection.rollback();

          sendError(
            response,
            403,
            "Teacher account is inactive",
          );
          return;
        }

        const [sessions] =
          await connection.execute<
            FinalizeTeachingSessionRow[]
          >(
            `SELECT
              teaching_sessions.id,
              teaching_sessions.schedule_id
                AS scheduleId,
              schedules.class_id AS classId,
              teaching_sessions.teacher_id
                AS teacherId,
              teaching_sessions.actual_minutes
                AS actualMinutes,
              teaching_sessions.status
                AS sessionStatus,
              schedules.status AS scheduleStatus
             FROM teaching_sessions
             INNER JOIN schedules
               ON schedules.id =
                  teaching_sessions.schedule_id
             WHERE teaching_sessions.id = ?
             LIMIT 1
             FOR UPDATE`,
            [teachingSessionId],
          );

        const teachingSession = sessions[0];

        if (teachingSession === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Teaching session not found",
          );
          return;
        }

        if (
          teachingSession.teacherId !==
          teacher.teacherId
        ) {
          await connection.rollback();

          sendError(
            response,
            403,
            "Teaching session does not belong to this teacher",
          );
          return;
        }

        if (
          teachingSession.sessionStatus !== "DRAFT"
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Only a DRAFT teaching session can be finalized",
          );
          return;
        }

        if (
          teachingSession.scheduleStatus ===
          "CANCELLED"
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "A cancelled schedule cannot be finalized",
          );
          return;
        }

        const [classMembers] =
          await connection.execute<
            FinalizeClassMemberRow[]
          >(
            `SELECT
              class_members.id AS classMemberId,
              enrollments.id AS enrollmentId,
              enrollments.status AS enrollmentStatus,
              enrollments.allocated_minutes
                AS allocatedMinutes
             FROM class_members
             INNER JOIN enrollments
               ON enrollments.id =
                  class_members.enrollment_id
             WHERE class_members.class_id = ?
               AND class_members.status = 'ACTIVE'
             ORDER BY class_members.id
             FOR UPDATE`,
            [teachingSession.classId],
          );

        if (classMembers.length === 0) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Class has no active members",
          );
          return;
        }

        const inactiveEnrollment =
          classMembers.find(
            (member) =>
              member.enrollmentStatus !== "ACTIVE",
          );

        if (inactiveEnrollment !== undefined) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Every active class member must have an active enrollment",
          );
          return;
        }

        const classMemberIds = classMembers.map(
          (member) => member.classMemberId,
        );

        const memberPlaceholders =
          classMemberIds.map(() => "?").join(", ");

        const [attendanceRows] =
          await connection.execute<
            FinalizeAttendanceRow[]
          >(
            `SELECT class_member_id AS classMemberId
             FROM attendances
             WHERE teaching_session_id = ?
               AND class_member_id IN (
                 ${memberPlaceholders}
               )
             FOR UPDATE`,
            [
              teachingSessionId,
              ...classMemberIds,
            ],
          );

        if (
          attendanceRows.length !==
          classMembers.length
        ) {
          const recordedMemberIds = new Set(
            attendanceRows.map(
              (attendance) =>
                attendance.classMemberId,
            ),
          );

          const missingClassMemberIds =
            classMemberIds.filter(
              (classMemberId) =>
                !recordedMemberIds.has(classMemberId),
            );

          await connection.rollback();

          sendError(
            response,
            409,
            "Attendance must be recorded for every active class member",
            {
              missingClassMemberIds,
            },
          );
          return;
        }

        const enrollmentIds = classMembers.map(
          (member) => member.enrollmentId,
        );

        const uniqueEnrollmentIds = [
          ...new Set(enrollmentIds),
        ];

        const enrollmentPlaceholders =
          uniqueEnrollmentIds
            .map(() => "?")
            .join(", ");

        const [usedMinuteRows] =
          await connection.execute<
            EnrollmentUsedMinutesRow[]
          >(
            `SELECT
              enrollments.id AS enrollmentId,
              COALESCE(
                SUM(
                  CASE
                    WHEN teaching_sessions.status =
                         'FINALIZED'
                    THEN teaching_sessions.actual_minutes
                    ELSE 0
                  END
                ),
                0
              ) AS usedMinutes
             FROM enrollments
             LEFT JOIN class_members
               ON class_members.enrollment_id =
                  enrollments.id
             LEFT JOIN attendances
               ON attendances.class_member_id =
                  class_members.id
             LEFT JOIN teaching_sessions
               ON teaching_sessions.id =
                  attendances.teaching_session_id
             WHERE enrollments.id IN (
               ${enrollmentPlaceholders}
             )
             GROUP BY enrollments.id`,
            uniqueEnrollmentIds,
          );

        const usedMinutesByEnrollment = new Map(
          usedMinuteRows.map((row) => [
            row.enrollmentId,
            Number(row.usedMinutes),
          ]),
        );

        const hourSummaries = classMembers.map(
          (member) => {
            const previousUsedMinutes =
              usedMinutesByEnrollment.get(
                member.enrollmentId,
              ) ?? 0;

            const usedMinutes =
              previousUsedMinutes +
              teachingSession.actualMinutes;

            const remainingMinutes =
              member.allocatedMinutes -
              usedMinutes;

            return {
              enrollmentId: member.enrollmentId,
              allocatedMinutes:
                member.allocatedMinutes,
              previousUsedMinutes,
              sessionMinutes:
                teachingSession.actualMinutes,
              usedMinutes,
              remainingMinutes,
            };
          },
        );

        const negativeRemaining =
          hourSummaries.find(
            (summary) =>
              summary.remainingMinutes < 0,
          );

        if (negativeRemaining !== undefined) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Teaching time exceeds the enrollment remaining minutes",
            negativeRemaining,
          );
          return;
        }

        await connection.execute<ResultSetHeader>(
          `UPDATE teaching_sessions
           SET status = 'FINALIZED',
               finalized_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND status = 'DRAFT'`,
          [teachingSessionId],
        );

        await connection.execute<ResultSetHeader>(
          `UPDATE schedules
           SET status = 'COMPLETED'
           WHERE id = ?`,
          [teachingSession.scheduleId],
        );

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Teaching session finalized successfully",
          {
            teachingSessionId,
            scheduleId:
              teachingSession.scheduleId,
            actualMinutes:
              teachingSession.actualMinutes,
            attendanceCount:
              attendanceRows.length,
            status: "FINALIZED",
            enrollments: hourSummaries,
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
