import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import { generatePassword, hashPassword } from "../utils/password.ts";
import { adminCreateTeacherSchema, adminUpdateTeacherSchema, adminUpdateTeacherStatusSchema } from "../validations/teacher-schema.ts";

interface TeacherRoleRow extends RowDataPacket {
  id: number;
}

interface ExistingUsernameRow extends RowDataPacket {
  id: number;
}

interface ExistingTeacherRow extends RowDataPacket {
  id: number;
}

interface TeacherAccountRow extends RowDataPacket {
  id: number;
  userId: number;
  isActive: number;
}

export const adminTeacherRouter = Router();

adminTeacherRouter.use(authenticate, authorizeRoles("ADMIN"));

adminTeacherRouter.post("/", async (request, response, next) => {
  try {
    const validationResult = adminCreateTeacherSchema.safeParse(request.body);

    if (!validationResult.success) {
      sendError(
        response,
        400,
        "Invalid teacher data",
        validationResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
      return;
    }

    const teacherData = validationResult.data;
    const generatedPassword = generatePassword();
    const passwordHash = await hashPassword(generatedPassword);

    const connection = await databasePool.getConnection();

    try {
      await connection.beginTransaction();

      const [existingUsers] = await connection.execute<ExistingUsernameRow[]>(
        `SELECT id
             FROM users
             WHERE username = ?
             LIMIT 1`,
        [teacherData.username],
      );

      if (existingUsers[0] !== undefined) {
        await connection.rollback();

        sendError(response, 409, "Username is already in use");
        return;
      }

      const [teacherRoles] = await connection.execute<TeacherRoleRow[]>(
        `SELECT id
             FROM roles
             WHERE name = 'TEACHER'
             LIMIT 1`,
      );

      const teacherRole = teacherRoles[0];

      if (teacherRole === undefined) {
        throw new Error("TEACHER role is not configured");
      }

      const [userResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (
              role_id,
              username,
              password_hash,
              is_active
            )
            VALUES (?, ?, ?, ?)`,
        [
          teacherRole.id,
          teacherData.username,
          passwordHash,
          teacherData.isActive,
        ],
      );

      const [teacherResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO teachers (
              user_id,
              title,
              first_name,
              last_name,
              phone,
              email,
              biography
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userResult.insertId,
          teacherData.title ?? null,
          teacherData.firstName,
          teacherData.lastName,
          teacherData.phone ?? null,
          teacherData.email === "" ? null : (teacherData.email ?? null),
          teacherData.biography ?? null,
        ],
      );

      await connection.commit();

      response.setHeader("Cache-Control", "no-store");

      sendSuccess(response, 201, "Teacher created successfully", {
        userId: userResult.insertId,
        teacherId: teacherResult.insertId,
        username: teacherData.username,
        generatedPassword,
        isActive: teacherData.isActive,
      });
    } catch (error) {
      await connection.rollback();

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      ) {
        sendError(response, 409, "Teacher conflicts with existing data");
        return;
      }

      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

adminTeacherRouter.patch(
  "/:teacherId",
  async (request, response, next) => {
    try {
      const teacherId = Number(request.params.teacherId);

      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        sendError(
          response,
          400,
          "Teacher ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminUpdateTeacherSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid teacher data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const teacherData = validationResult.data;

      const [existingTeachers] =
        await databasePool.execute<ExistingTeacherRow[]>(
          `SELECT id
           FROM teachers
           WHERE id = ?
           LIMIT 1`,
          [teacherId],
        );

      if (existingTeachers[0] === undefined) {
        sendError(response, 404, "Teacher not found");
        return;
      }

      const updateFields: string[] = [];
      const updateValues: Array<string | number | null> = [];

      if ("title" in teacherData) {
        updateFields.push("title = ?");
        updateValues.push(teacherData.title ?? null);
      }

      if ("firstName" in teacherData) {
        updateFields.push("first_name = ?");
        updateValues.push(teacherData.firstName!);
      }

      if ("lastName" in teacherData) {
        updateFields.push("last_name = ?");
        updateValues.push(teacherData.lastName!);
      }

      if ("phone" in teacherData) {
        updateFields.push("phone = ?");
        updateValues.push(teacherData.phone ?? null);
      }

      if ("email" in teacherData) {
        updateFields.push("email = ?");
        updateValues.push(
          teacherData.email === ""
            ? null
            : teacherData.email ?? null,
        );
      }

      if ("biography" in teacherData) {
        updateFields.push("biography = ?");
        updateValues.push(teacherData.biography ?? null);
      }

      updateValues.push(teacherId);

      await databasePool.execute<ResultSetHeader>(
        `UPDATE teachers
         SET ${updateFields.join(", ")}
         WHERE id = ?`,
        updateValues,
      );

      sendSuccess(
        response,
        200,
        "Teacher updated successfully",
        {
          teacherId,
          updatedFields: Object.keys(teacherData),
        },
      );
    } catch (error) {
      next(error);
    }
  },
);

adminTeacherRouter.patch(
  "/:teacherId/status",
  async (request, response, next) => {
    try {
      const teacherId = Number(request.params.teacherId);

      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        sendError(
          response,
          400,
          "Teacher ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminUpdateTeacherStatusSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid teacher status",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { isActive } = validationResult.data;
      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [teachers] =
          await connection.execute<TeacherAccountRow[]>(
            `SELECT
              teachers.id,
              teachers.user_id AS userId,
              users.is_active AS isActive
             FROM teachers
             INNER JOIN users
               ON users.id = teachers.user_id
             WHERE teachers.id = ?
             LIMIT 1
             FOR UPDATE`,
            [teacherId],
          );

        const teacher = teachers[0];

        if (teacher === undefined) {
          await connection.rollback();
          sendError(response, 404, "Teacher not found");
          return;
        }

        await connection.execute<ResultSetHeader>(
          `UPDATE users
           SET is_active = ?
           WHERE id = ?`,
          [isActive, teacher.userId],
        );

        await connection.commit();

        sendSuccess(
          response,
          200,
          isActive
            ? "Teacher account activated successfully"
            : "Teacher account deactivated successfully",
          {
            teacherId,
            userId: teacher.userId,
            isActive,
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
