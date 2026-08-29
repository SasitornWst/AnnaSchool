import { Router } from "express";
import { createApplicationSchema } from "../validations/application-schema.ts";
import { hashPassword } from "../utils/password.ts";
import { databasePool } from "../config/database.ts";

import type {
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";

import {
  sendError,
  sendSuccess,
} from "../utils/api-response.ts";

import {
  parentRegistrationSchema,
} from "../validations/parent-registration-schema.ts";

interface PublicCourseRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  recommendedMinAge: number | null;
  recommendedMaxAge: number | null;
  price: string;
  totalMinutes: number;
  promotionText: string | null;
  imagePath: string | null;
}

interface CourseAvailabilityRow extends RowDataPacket {
  id: number;
}

interface RegistrationApplicationRow extends RowDataPacket {
  id: number;
  parentId: number | null;
  parentPhone: string;
  status: string;
}

interface ParentRoleRow extends RowDataPacket {
  id: number;
}

interface ExistingUsernameRow extends RowDataPacket {
  id: number;
}

function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

export const publicRouter = Router();

publicRouter.get("/courses", async (_request, response, next) => {
  try {
    const [courses] = await databasePool.execute<PublicCourseRow[]>(
      `SELECT
        id,
        name,
        description,
        recommended_min_age AS recommendedMinAge,
        recommended_max_age AS recommendedMaxAge,
        price,
        total_minutes AS totalMinutes,
        promotion_text AS promotionText,
        image_path AS imagePath
      FROM courses
      WHERE is_open = TRUE
      ORDER BY id ASC`,
    );

    sendSuccess(
      response,
      200,
      "Public courses retrieved successfully",
      courses,
    );
  } catch (error) {
    next(error);
  }
});

publicRouter.get(
  "/courses/:courseId",
  async (request, response, next) => {
    try {
      const courseId = Number(request.params.courseId);

      if (!Number.isInteger(courseId) || courseId <= 0) {
        sendError(response, 400, "Course ID must be a positive integer");
        return;
      }

      const [courses] = await databasePool.execute<PublicCourseRow[]>(
        `SELECT
          id,
          name,
          description,
          recommended_min_age AS recommendedMinAge,
          recommended_max_age AS recommendedMaxAge,
          price,
          total_minutes AS totalMinutes,
          promotion_text AS promotionText,
          image_path AS imagePath
        FROM courses
        WHERE id = ?
          AND is_open = TRUE
        LIMIT 1`,
        [courseId],
      );

      const course = courses[0];

      if (course === undefined) {
        sendError(response, 404, "Course not found");
        return;
      }

      sendSuccess(
        response,
        200,
        "Public course retrieved successfully",
        course,
      );
    } catch (error) {
      next(error);
    }
  },
);

publicRouter.post(
  "/applications",
  async (request, response, next) => {
    try {
      const validationResult =
        createApplicationSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid application data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { parent, students } = validationResult.data;
      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        for (const [index, student] of students.entries()) {
          if (student.interestedCourseId == null) {
            continue;
          }

          const [availableCourses] =
            await connection.execute<CourseAvailabilityRow[]>(
              `SELECT id
               FROM courses
               WHERE id = ?
                 AND is_open = TRUE
               LIMIT 1`,
              [student.interestedCourseId],
            );

          if (availableCourses[0] === undefined) {
            await connection.rollback();

            sendError(
              response,
              400,
              `Student at index ${index} selected an unavailable course`,
            );
            return;
          }
        }

        const [applicationResult] =
          await connection.execute<ResultSetHeader>(
            `INSERT INTO applications (
              parent_id,
              parent_title,
              parent_first_name,
              parent_last_name,
              parent_phone,
              parent_email,
              parent_line_id,
              parent_address,
              status
            )
            VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'NEW')`,
            [
              parent.title ?? null,
              parent.firstName,
              parent.lastName,
              parent.phone,
              parent.email === "" ? null : parent.email ?? null,
              parent.lineId ?? null,
              parent.address ?? null,
            ],
          );

        for (const student of students) {
          await connection.execute(
            `INSERT INTO application_students (
              application_id,
              student_id,
              title,
              first_name,
              last_name,
              nickname,
              birth_date,
              school_name,
              medical_condition,
              interested_course_id,
              assessed_level_id,
              assessment_note
            )
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
            [
              applicationResult.insertId,
              student.title ?? null,
              student.firstName,
              student.lastName,
              student.nickname ?? null,
              student.birthDate,
              student.schoolName ?? null,
              student.medicalCondition ?? null,
              student.interestedCourseId ?? null,
            ],
          );
        }

        await connection.commit();

        sendSuccess(
          response,
          201,
          "Application submitted successfully",
          {
            applicationId: applicationResult.insertId,
            status: "NEW",
            studentCount: students.length,
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

publicRouter.post(
  "/parent-registrations",
  async (request, response, next) => {
    try {
      const validationResult =
        parentRegistrationSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid parent registration data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const {
        applicationId,
        username,
        password,
        parent,
      } = validationResult.data;

      const passwordHash = await hashPassword(password);
      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [applications] =
          await connection.execute<RegistrationApplicationRow[]>(
            `SELECT
              id,
              parent_id AS parentId,
              parent_phone AS parentPhone,
              status
            FROM applications
            WHERE id = ?
            LIMIT 1
            FOR UPDATE`,
            [applicationId],
          );

        const application = applications[0];

        const submittedPhone =
          normalizePhoneNumber(parent.phone);

        const applicationPhone =
          application === undefined
            ? ""
            : normalizePhoneNumber(application.parentPhone);

        const allowedStatuses = [
          "CONTACTED",
          "ASSESSED",
          "APPROVED",
        ];

        if (
          application === undefined ||
          application.parentId !== null ||
          submittedPhone === "" ||
          submittedPhone !== applicationPhone ||
          !allowedStatuses.includes(application.status)
        ) {
          await connection.rollback();

          sendError(
            response,
            400,
            "Application information could not be verified",
          );
          return;
        }

        const [existingUsers] =
          await connection.execute<ExistingUsernameRow[]>(
            `SELECT id
             FROM users
             WHERE username = ?
             LIMIT 1`,
            [username],
          );

        if (existingUsers[0] !== undefined) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Username is already in use",
          );
          return;
        }

        const [parentRoles] =
          await connection.execute<ParentRoleRow[]>(
            `SELECT id
             FROM roles
             WHERE name = 'PARENT'
             LIMIT 1`,
          );

        const parentRole = parentRoles[0];

        if (parentRole === undefined) {
          throw new Error("PARENT role is not configured");
        }

        const [userResult] =
          await connection.execute<ResultSetHeader>(
            `INSERT INTO users (
              role_id,
              username,
              password_hash,
              is_active
            )
            VALUES (?, ?, ?, FALSE)`,
            [
              parentRole.id,
              username,
              passwordHash,
            ],
          );

        const [parentResult] =
          await connection.execute<ResultSetHeader>(
            `INSERT INTO parents (
              user_id,
              title,
              first_name,
              last_name,
              phone,
              email,
              line_id,
              address
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userResult.insertId,
              parent.title ?? null,
              parent.firstName,
              parent.lastName,
              parent.phone,
              parent.email === ""
                ? null
                : parent.email ?? null,
              parent.lineId ?? null,
              parent.address ?? null,
            ],
          );

        await connection.execute(
          `UPDATE applications
           SET parent_id = ?
           WHERE id = ?`,
          [parentResult.insertId, applicationId],
        );

        await connection.commit();

        sendSuccess(
          response,
          201,
          "Parent registration submitted for approval",
          {
            userId: userResult.insertId,
            parentId: parentResult.insertId,
            applicationId,
            status: "PENDING_APPROVAL",
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
            "Registration conflicts with existing data",
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