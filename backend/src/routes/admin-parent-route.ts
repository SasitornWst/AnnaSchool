import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

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
  generatePassword,
  hashPassword,
} from "../utils/password.ts";
import {
  adminCreateParentSchema,
  rejectParentRegistrationSchema,
} from "../validations/parent-registration-schema.ts";

interface PendingParentRegistrationRow extends RowDataPacket {
  parentId: number;
  userId: number;
  username: string;
  title: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  applicationId: number | null;
  applicationStatus: string | null;
  approvalStatus: string;
  createdAt: Date;
}

interface ParentApprovalRow extends RowDataPacket {
  userId: number;
  approvalStatus: string;
}

interface AdminCreateApplicationRow extends RowDataPacket {
  parentId: number | null;
  parentTitle: string | null;
  parentFirstName: string;
  parentLastName: string;
  parentPhone: string;
  parentEmail: string | null;
  parentLineId: string | null;
  parentAddress: string | null;
  status: string;
}

interface AdminCreateApplicationStudentRow extends RowDataPacket {
  id: number;
  studentId: number | null;
  title: string | null;
  firstName: string;
  lastName: string;
  nickname: string | null;
  birthDate: Date;
  schoolName: string | null;
  medicalCondition: string | null;
}

interface ParentRoleRow extends RowDataPacket {
  id: number;
}

interface ExistingUsernameRow extends RowDataPacket {
  id: number;
}

export const adminParentRouter = Router();

adminParentRouter.use(
  authenticate,
  authorizeRoles("ADMIN"),
);

adminParentRouter.get(
  "/registrations/pending",
  async (_request, response, next) => {
    try {
      const [registrations] =
        await databasePool.execute<PendingParentRegistrationRow[]>(
          `SELECT
            parents.id AS parentId,
            users.id AS userId,
            users.username,
            parents.title,
            parents.first_name AS firstName,
            parents.last_name AS lastName,
            parents.phone,
            parents.email,
            applications.id AS applicationId,
            applications.status AS applicationStatus,
            parents.approval_status AS approvalStatus,
            parents.created_at AS createdAt
          FROM parents
          INNER JOIN users
            ON users.id = parents.user_id
          LEFT JOIN applications
            ON applications.parent_id = parents.id
          WHERE parents.approval_status = 'PENDING'
          ORDER BY parents.created_at ASC,
                   parents.id ASC`,
        );

      sendSuccess(
        response,
        200,
        "Pending parent registrations retrieved successfully",
        registrations,
      );
    } catch (error) {
      next(error);
    }
  },
);

adminParentRouter.patch(
  "/registrations/:parentId/approve",
  async (request, response, next) => {
    try {
      const parentId = Number(request.params.parentId);

      if (!Number.isInteger(parentId) || parentId <= 0) {
        sendError(
          response,
          400,
          "Parent ID must be a positive integer",
        );
        return;
      }

      const authenticatedAdmin =
        response.locals.auth as AuthTokenPayload;

      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [parents] =
          await connection.execute<ParentApprovalRow[]>(
            `SELECT
              user_id AS userId,
              approval_status AS approvalStatus
            FROM parents
            WHERE id = ?
            LIMIT 1
            FOR UPDATE`,
            [parentId],
          );

        const parent = parents[0];

        if (parent === undefined) {
          await connection.rollback();
          sendError(response, 404, "Parent registration not found");
          return;
        }

        if (parent.approvalStatus !== "PENDING") {
          await connection.rollback();

          sendError(
            response,
            409,
            `Parent registration is already ${parent.approvalStatus}`,
          );
          return;
        }

        await connection.execute(
          `UPDATE parents
           SET approval_status = 'APPROVED',
               reviewed_at = CURRENT_TIMESTAMP,
               reviewed_by_user_id = ?,
               rejection_reason = NULL
           WHERE id = ?`,
          [authenticatedAdmin.userId, parentId],
        );

        await connection.execute(
          `UPDATE users
           SET is_active = TRUE
           WHERE id = ?`,
          [parent.userId],
        );

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Parent registration approved successfully",
          {
            parentId,
            userId: parent.userId,
            approvalStatus: "APPROVED",
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

adminParentRouter.patch(
  "/registrations/:parentId/reject",
  async (request, response, next) => {
    try {
      const parentId = Number(request.params.parentId);

      if (!Number.isInteger(parentId) || parentId <= 0) {
        sendError(
          response,
          400,
          "Parent ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        rejectParentRegistrationSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid rejection data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const authenticatedAdmin =
        response.locals.auth as AuthTokenPayload;

      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [parents] =
          await connection.execute<ParentApprovalRow[]>(
            `SELECT
              user_id AS userId,
              approval_status AS approvalStatus
            FROM parents
            WHERE id = ?
            LIMIT 1
            FOR UPDATE`,
            [parentId],
          );

        const parent = parents[0];

        if (parent === undefined) {
          await connection.rollback();
          sendError(response, 404, "Parent registration not found");
          return;
        }

        if (parent.approvalStatus !== "PENDING") {
          await connection.rollback();

          sendError(
            response,
            409,
            `Parent registration is already ${parent.approvalStatus}`,
          );
          return;
        }

        await connection.execute(
          `UPDATE parents
           SET approval_status = 'REJECTED',
               reviewed_at = CURRENT_TIMESTAMP,
               reviewed_by_user_id = ?,
               rejection_reason = ?
           WHERE id = ?`,
          [
            authenticatedAdmin.userId,
            validationResult.data.reason,
            parentId,
          ],
        );

        await connection.execute(
          `UPDATE users
           SET is_active = FALSE
           WHERE id = ?`,
          [parent.userId],
        );

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Parent registration rejected successfully",
          {
            parentId,
            userId: parent.userId,
            approvalStatus: "REJECTED",
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

adminParentRouter.post(
  "/",
  async (request, response, next) => {
    try {
      const validationResult =
        adminCreateParentSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid parent account data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { applicationId, username } = validationResult.data;
      const authenticatedAdmin =
        response.locals.auth as AuthTokenPayload;

      const generatedPassword = generatePassword();
      const passwordHash = await hashPassword(generatedPassword);
      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [applications] =
          await connection.execute<AdminCreateApplicationRow[]>(
            `SELECT
              parent_id AS parentId,
              parent_title AS parentTitle,
              parent_first_name AS parentFirstName,
              parent_last_name AS parentLastName,
              parent_phone AS parentPhone,
              parent_email AS parentEmail,
              parent_line_id AS parentLineId,
              parent_address AS parentAddress,
              status
            FROM applications
            WHERE id = ?
            LIMIT 1
            FOR UPDATE`,
            [applicationId],
          );

        const application = applications[0];

        if (application === undefined) {
          await connection.rollback();
          sendError(response, 404, "Application not found");
          return;
        }

        if (application.status !== "APPROVED") {
          await connection.rollback();
          sendError(
            response,
            409,
            "Application must be APPROVED before creating a parent account",
          );
          return;
        }

        if (application.parentId !== null) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Application is already linked to a parent account",
          );
          return;
        }

        const [applicationStudents] =
          await connection.execute<AdminCreateApplicationStudentRow[]>(
            `SELECT
              id,
              student_id AS studentId,
              title,
              first_name AS firstName,
              last_name AS lastName,
              nickname,
              birth_date AS birthDate,
              school_name AS schoolName,
              medical_condition AS medicalCondition
            FROM application_students
            WHERE application_id = ?
            ORDER BY id ASC
            FOR UPDATE`,
            [applicationId],
          );

        if (applicationStudents.length === 0) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Application must contain at least one student",
          );
          return;
        }

        if (
          applicationStudents.some(
            (student) => student.studentId !== null,
          )
        ) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Application students are already linked",
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
          sendError(response, 409, "Username is already in use");
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
            VALUES (?, ?, ?, TRUE)`,
            [parentRole.id, username, passwordHash],
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
              address,
              approval_status,
              reviewed_at,
              reviewed_by_user_id,
              rejection_reason
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?,
              'APPROVED', CURRENT_TIMESTAMP, ?, NULL
            )`,
            [
              userResult.insertId,
              application.parentTitle,
              application.parentFirstName,
              application.parentLastName,
              application.parentPhone,
              application.parentEmail,
              application.parentLineId,
              application.parentAddress,
              authenticatedAdmin.userId,
            ],
          );

        const studentIds: number[] = [];

        for (const applicationStudent of applicationStudents) {
          const [studentResult] =
            await connection.execute<ResultSetHeader>(
              `INSERT INTO students (
                parent_id,
                title,
                first_name,
                last_name,
                nickname,
                birth_date,
                school_name,
                medical_condition
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                parentResult.insertId,
                applicationStudent.title,
                applicationStudent.firstName,
                applicationStudent.lastName,
                applicationStudent.nickname,
                applicationStudent.birthDate,
                applicationStudent.schoolName,
                applicationStudent.medicalCondition,
              ],
            );

          await connection.execute(
            `UPDATE application_students
             SET student_id = ?
             WHERE id = ?`,
            [studentResult.insertId, applicationStudent.id],
          );

          studentIds.push(studentResult.insertId);
        }

        await connection.execute(
          `UPDATE applications
           SET parent_id = ?
           WHERE id = ?`,
          [parentResult.insertId, applicationId],
        );

        await connection.commit();

        response.setHeader("Cache-Control", "no-store");

        sendSuccess(
          response,
          201,
          "Parent account created successfully",
          {
            userId: userResult.insertId,
            parentId: parentResult.insertId,
            studentIds,
            applicationId,
            username,
            generatedPassword,
            approvalStatus: "APPROVED",
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
            "Parent account conflicts with existing data",
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
