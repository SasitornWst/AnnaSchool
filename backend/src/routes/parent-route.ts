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