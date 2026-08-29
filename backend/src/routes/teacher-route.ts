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