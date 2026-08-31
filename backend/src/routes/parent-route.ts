import { Router } from "express";
import type { RowDataPacket } from "mysql2";

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

interface ParentIdentityRow extends RowDataPacket {
  parentId: number;
  isActive: number;
}

interface OwnedStudentRow extends RowDataPacket {
  id: number;
  firstName: string;
  lastName: string;
}

interface ParentStudentScheduleRow extends RowDataPacket {
  id: number;
  classId: number;
  classCode: string;
  className: string;
  courseId: number;
  courseName: string;
  levelId: number;
  levelName: string;
  teacherId: number;
  teacherFirstName: string;
  teacherLastName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: string;
  location: string | null;
  note: string | null;
}

interface ParentEnrollmentHoursRow
  extends RowDataPacket {
  enrollmentId: number;
  courseId: number;
  courseName: string;
  levelId: number;
  levelName: string;
  enrollmentStatus: string;
  allocatedMinutes: number;
  usedMinutes: string | number;
  remainingMinutes: string | number;
}

interface ParentLearningHistoryRow
  extends RowDataPacket {
  teachingSessionId: number;
  enrollmentId: number;
  courseName: string;
  levelName: string;
  classCode: string;
  className: string;
  teacherFirstName: string;
  teacherLastName: string;
  startedAt: string;
  endedAt: string;
  actualMinutes: number;
  lessonContent: string | null;
  progressNote: string | null;
  attendanceStatus: string;
  attendanceNote: string | null;
}

export const parentRouter = Router();

parentRouter.use(
  authenticate,
  authorizeRoles("PARENT"),
);

parentRouter.get(
  "/students/:studentId/schedules",
  async (request, response, next) => {
    try {
      const studentId =
        Number(request.params.studentId);

      if (
        !Number.isInteger(studentId) ||
        studentId <= 0
      ) {
        sendError(
          response,
          400,
          "Student ID must be a positive integer",
        );
        return;
      }

      const authenticatedParent =
        response.locals.auth as AuthTokenPayload;

      const [parents] =
        await databasePool.execute<ParentIdentityRow[]>(
          `SELECT
            parents.id AS parentId,
            users.is_active AS isActive
           FROM parents
           INNER JOIN users
             ON users.id = parents.user_id
           WHERE parents.user_id = ?
           LIMIT 1`,
          [authenticatedParent.userId],
        );

      const parent = parents[0];

      if (parent === undefined) {
        sendError(response, 404, "Parent profile not found");
        return;
      }

      if (parent.isActive !== 1) {
        sendError(response, 403, "Parent account is inactive");
        return;
      }

      const [students] =
        await databasePool.execute<OwnedStudentRow[]>(
          `SELECT
            id,
            first_name AS firstName,
            last_name AS lastName
           FROM students
           WHERE id = ?
             AND parent_id = ?
           LIMIT 1`,
          [studentId, parent.parentId],
        );

      const student = students[0];

      if (student === undefined) {
        sendError(response, 404, "Student not found");
        return;
      }

      const [schedules] =
        await databasePool.execute<
          ParentStudentScheduleRow[]
        >(
          `SELECT DISTINCT
            schedules.id,
            classes.id AS classId,
            classes.class_code AS classCode,
            classes.class_name AS className,
            courses.id AS courseId,
            courses.name AS courseName,
            levels.id AS levelId,
            levels.name AS levelName,
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
            schedules.note
           FROM enrollments
           INNER JOIN class_members
             ON class_members.enrollment_id =
                enrollments.id
            AND class_members.status = 'ACTIVE'
           INNER JOIN classes
             ON classes.id = class_members.class_id
           INNER JOIN schedules
             ON schedules.class_id = classes.id
           INNER JOIN courses
             ON courses.id = enrollments.course_id
           INNER JOIN levels
             ON levels.id = enrollments.level_id
           INNER JOIN teachers
             ON teachers.id = schedules.teacher_id
           WHERE enrollments.student_id = ?
             AND enrollments.status = 'ACTIVE'
           ORDER BY
             scheduledDate ASC,
             startTime ASC,
             schedules.id ASC`,
          [studentId],
        );

      sendSuccess(
        response,
        200,
        "Student schedules retrieved successfully",
        {
          student,
          schedules,
        },
      );
    } catch (error) {
      next(error);
    }
  },
);

parentRouter.get(
  "/students/:studentId/learning-summary",
  async (request, response, next) => {
    try {
      const studentId =
        Number(request.params.studentId);

      if (
        !Number.isInteger(studentId) ||
        studentId <= 0
      ) {
        sendError(
          response,
          400,
          "Student ID must be a positive integer",
        );
        return;
      }

      const authenticatedParent =
        response.locals.auth as AuthTokenPayload;

      const [parents] =
        await databasePool.execute<ParentIdentityRow[]>(
          `SELECT
            parents.id AS parentId,
            users.is_active AS isActive
           FROM parents
           INNER JOIN users
             ON users.id = parents.user_id
           WHERE parents.user_id = ?
           LIMIT 1`,
          [authenticatedParent.userId],
        );

      const parent = parents[0];

      if (parent === undefined) {
        sendError(
          response,
          404,
          "Parent profile not found",
        );
        return;
      }

      if (parent.isActive !== 1) {
        sendError(
          response,
          403,
          "Parent account is inactive",
        );
        return;
      }

      const [students] =
        await databasePool.execute<OwnedStudentRow[]>(
          `SELECT
            id,
            first_name AS firstName,
            last_name AS lastName
           FROM students
           WHERE id = ?
             AND parent_id = ?
           LIMIT 1`,
          [studentId, parent.parentId],
        );

      const student = students[0];

      if (student === undefined) {
        sendError(
          response,
          404,
          "Student not found",
        );
        return;
      }

      const [enrollmentRows] =
        await databasePool.execute<
          ParentEnrollmentHoursRow[]
        >(
          `SELECT
            enrollments.id AS enrollmentId,
            courses.id AS courseId,
            courses.name AS courseName,
            levels.id AS levelId,
            levels.name AS levelName,
            enrollments.status AS enrollmentStatus,
            enrollments.allocated_minutes
              AS allocatedMinutes,

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
            ) AS usedMinutes,

            enrollments.allocated_minutes -
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
            ) AS remainingMinutes

           FROM enrollments

           INNER JOIN courses
             ON courses.id = enrollments.course_id

           INNER JOIN levels
             ON levels.id = enrollments.level_id

           LEFT JOIN class_members
             ON class_members.enrollment_id =
                enrollments.id

           LEFT JOIN attendances
             ON attendances.class_member_id =
                class_members.id

           LEFT JOIN teaching_sessions
             ON teaching_sessions.id =
                attendances.teaching_session_id

           WHERE enrollments.student_id = ?

           GROUP BY
             enrollments.id,
             courses.id,
             courses.name,
             levels.id,
             levels.name,
             enrollments.status,
             enrollments.allocated_minutes

           ORDER BY enrollments.id`,
          [studentId],
        );

      const enrollments = enrollmentRows.map(
        (enrollment) => ({
          ...enrollment,
          usedMinutes:
            Number(enrollment.usedMinutes),
          remainingMinutes:
            Number(enrollment.remainingMinutes),
        }),
      );

      const [history] =
        await databasePool.execute<
          ParentLearningHistoryRow[]
        >(
          `SELECT
            teaching_sessions.id
              AS teachingSessionId,
            enrollments.id AS enrollmentId,
            courses.name AS courseName,
            levels.name AS levelName,
            classes.class_code AS classCode,
            classes.class_name AS className,
            teachers.first_name
              AS teacherFirstName,
            teachers.last_name
              AS teacherLastName,

            DATE_FORMAT(
              teaching_sessions.started_at,
              '%Y-%m-%dT%H:%i:%s'
            ) AS startedAt,

            DATE_FORMAT(
              teaching_sessions.ended_at,
              '%Y-%m-%dT%H:%i:%s'
            ) AS endedAt,

            teaching_sessions.actual_minutes
              AS actualMinutes,
            teaching_sessions.lesson_content
              AS lessonContent,
            teaching_sessions.progress_note
              AS progressNote,
            attendances.status
              AS attendanceStatus,
            attendances.note AS attendanceNote

           FROM enrollments

           INNER JOIN courses
             ON courses.id = enrollments.course_id

           INNER JOIN levels
             ON levels.id = enrollments.level_id

           INNER JOIN class_members
             ON class_members.enrollment_id =
                enrollments.id

           INNER JOIN attendances
             ON attendances.class_member_id =
                class_members.id

           INNER JOIN teaching_sessions
             ON teaching_sessions.id =
                attendances.teaching_session_id
            AND teaching_sessions.status =
                'FINALIZED'

           INNER JOIN schedules
             ON schedules.id =
                teaching_sessions.schedule_id

           INNER JOIN classes
             ON classes.id = schedules.class_id

           INNER JOIN teachers
             ON teachers.id =
                teaching_sessions.teacher_id

           WHERE enrollments.student_id = ?

           ORDER BY
             teaching_sessions.started_at DESC,
             teaching_sessions.id DESC`,
          [studentId],
        );

      sendSuccess(
        response,
        200,
        "Student learning summary retrieved successfully",
        {
          student,
          enrollments,
          history,
        },
      );
    } catch (error) {
      next(error);
    }
  },
);