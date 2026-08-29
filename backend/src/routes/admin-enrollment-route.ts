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
import {
  adminCreateEnrollmentSchema,
} from "../validations/enrollment-schema.ts";

interface ExistingRow extends RowDataPacket {
  id: number;
}

interface ApplicationStudentRow extends RowDataPacket {
  id: number;
  studentId: number | null;
}

export const adminEnrollmentRouter = Router();

adminEnrollmentRouter.use(
  authenticate,
  authorizeRoles("ADMIN"),
);

adminEnrollmentRouter.post(
  "/",
  async (request, response, next) => {
    try {
      const validationResult =
        adminCreateEnrollmentSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid enrollment data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const enrollmentData = validationResult.data;
      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [students] =
          await connection.execute<ExistingRow[]>(
            `SELECT id
             FROM students
             WHERE id = ?
             LIMIT 1`,
            [enrollmentData.studentId],
          );

        if (students[0] === undefined) {
          await connection.rollback();
          sendError(response, 400, "Student does not exist");
          return;
        }

        const [courses] =
          await connection.execute<ExistingRow[]>(
            `SELECT id
             FROM courses
             WHERE id = ?
             LIMIT 1`,
            [enrollmentData.courseId],
          );

        if (courses[0] === undefined) {
          await connection.rollback();
          sendError(response, 400, "Course does not exist");
          return;
        }

        const [levels] =
          await connection.execute<ExistingRow[]>(
            `SELECT id
             FROM levels
             WHERE id = ?
               AND is_active = TRUE
             LIMIT 1`,
            [enrollmentData.levelId],
          );

        if (levels[0] === undefined) {
          await connection.rollback();

          sendError(
            response,
            400,
            "Active level does not exist",
          );
          return;
        }

        if (
          enrollmentData.applicationStudentId !== null &&
          enrollmentData.applicationStudentId !== undefined
        ) {
          const [applicationStudents] =
            await connection.execute<ApplicationStudentRow[]>(
              `SELECT
                id,
                student_id AS studentId
               FROM application_students
               WHERE id = ?
               LIMIT 1`,
              [enrollmentData.applicationStudentId],
            );

          const applicationStudent = applicationStudents[0];

          if (applicationStudent === undefined) {
            await connection.rollback();

            sendError(
              response,
              400,
              "Application student does not exist",
            );
            return;
          }

          if (
            applicationStudent.studentId !==
            enrollmentData.studentId
          ) {
            await connection.rollback();

            sendError(
              response,
              400,
              "Application student is not linked to the selected student",
            );
            return;
          }
        }

        const [result] =
          await connection.execute<ResultSetHeader>(
            `INSERT INTO enrollments (
              student_id,
              course_id,
              level_id,
              application_student_id,
              allocated_minutes,
              price_at_enrollment,
              status,
              start_date,
              end_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              enrollmentData.studentId,
              enrollmentData.courseId,
              enrollmentData.levelId,
              enrollmentData.applicationStudentId ?? null,
              enrollmentData.allocatedMinutes,
              enrollmentData.priceAtEnrollment,
              enrollmentData.status,
              enrollmentData.startDate ?? null,
              enrollmentData.endDate ?? null,
            ],
          );

        await connection.commit();

        sendSuccess(
          response,
          201,
          "Enrollment created successfully",
          {
            enrollmentId: result.insertId,
            studentId: enrollmentData.studentId,
            courseId: enrollmentData.courseId,
            levelId: enrollmentData.levelId,
            status: enrollmentData.status,
            allocatedMinutes:
              enrollmentData.allocatedMinutes,
            priceAtEnrollment:
              enrollmentData.priceAtEnrollment,
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
            "Application student already has an enrollment",
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