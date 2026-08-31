import { Router } from "express";
import type { RowDataPacket } from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";

interface StudentRow extends RowDataPacket {
  id: number;
  firstName: string;
  lastName: string;
}

interface EnrollmentHoursRow extends RowDataPacket {
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

interface LearningHistoryRow extends RowDataPacket {
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
  teacherNote: string | null;
  attendanceStatus: string;
  attendanceNote: string | null;
}

export const adminStudentRouter = Router();

adminStudentRouter.use(authenticate, authorizeRoles("ADMIN"));

adminStudentRouter.get(
  "/:studentId/learning-summary",
  async (request, response, next) => {
    try {
      const studentId = Number(request.params.studentId);

      if (!Number.isInteger(studentId) || studentId <= 0) {
        sendError(response, 400, "Student ID must be a positive integer");
        return;
      }

      const [students] = await databasePool.execute<StudentRow[]>(
        `SELECT
             id,
             first_name AS firstName,
             last_name AS lastName
           FROM students
           WHERE id = ?
           LIMIT 1`,
        [studentId],
      );

      const student = students[0];

      if (student === undefined) {
        sendError(response, 404, "Student not found");
        return;
      }

      const [enrollmentRows] = await databasePool.execute<EnrollmentHoursRow[]>(
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
             WHEN teaching_sessions.status = 'FINALIZED'
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
             WHEN teaching_sessions.status = 'FINALIZED'
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
       ON class_members.enrollment_id = enrollments.id

     LEFT JOIN attendances
       ON attendances.class_member_id = class_members.id

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

      const enrollments = enrollmentRows.map((enrollment) => ({
        ...enrollment,
        usedMinutes: Number(enrollment.usedMinutes),
        remainingMinutes: Number(enrollment.remainingMinutes),
      }));

      const [history] = await databasePool.execute<LearningHistoryRow[]>(
        `SELECT
       teaching_sessions.id AS teachingSessionId,
       enrollments.id AS enrollmentId,
       courses.name AS courseName,
       levels.name AS levelName,
       classes.class_code AS classCode,
       classes.class_name AS className,
       teachers.first_name AS teacherFirstName,
       teachers.last_name AS teacherLastName,

       DATE_FORMAT(
         teaching_sessions.started_at,
         '%Y-%m-%dT%H:%i:%s'
       ) AS startedAt,

       DATE_FORMAT(
         teaching_sessions.ended_at,
         '%Y-%m-%dT%H:%i:%s'
       ) AS endedAt,

       teaching_sessions.actual_minutes AS actualMinutes,
       teaching_sessions.lesson_content AS lessonContent,
       teaching_sessions.progress_note AS progressNote,
       teaching_sessions.teacher_note AS teacherNote,
       attendances.status AS attendanceStatus,
       attendances.note AS attendanceNote

     FROM enrollments

     INNER JOIN courses
       ON courses.id = enrollments.course_id

     INNER JOIN levels
       ON levels.id = enrollments.level_id

     INNER JOIN class_members
       ON class_members.enrollment_id = enrollments.id

     INNER JOIN attendances
       ON attendances.class_member_id = class_members.id

     INNER JOIN teaching_sessions
       ON teaching_sessions.id =
          attendances.teaching_session_id
      AND teaching_sessions.status = 'FINALIZED'

     INNER JOIN schedules
       ON schedules.id = teaching_sessions.schedule_id

     INNER JOIN classes
       ON classes.id = schedules.class_id

     INNER JOIN teachers
       ON teachers.id = teaching_sessions.teacher_id

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
