import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import {
  adminAddClassMemberSchema,
  adminCreateClassSchema,
  adminMoveClassMemberSchema,
} from "../validations/class-schema.ts";

interface ExistingRow extends RowDataPacket {
  id: number;
}

interface ClassForMemberRow extends RowDataPacket {
  id: number;
  courseId: number;
  levelId: number;
  status: string;
}

interface EnrollmentForMemberRow extends RowDataPacket {
  id: number;
  studentId: number;
  courseId: number;
  levelId: number;
  status: string;
}

interface ClassMemberRow extends RowDataPacket {
  id: number;
  classId: number;
}

interface ClassMemberForRemovalRow extends RowDataPacket {
  id: number;
  enrollmentId: number;
  status: string;
}

export const adminClassRouter = Router();

adminClassRouter.use(authenticate, authorizeRoles("ADMIN"));

adminClassRouter.post("/", async (request, response, next) => {
  try {
    const validationResult = adminCreateClassSchema.safeParse(request.body);

    if (!validationResult.success) {
      sendError(
        response,
        400,
        "Invalid class data",
        validationResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
      return;
    }

    const classData = validationResult.data;

    const [courses] = await databasePool.execute<ExistingRow[]>(
      `SELECT id
           FROM courses
           WHERE id = ?
           LIMIT 1`,
      [classData.courseId],
    );

    if (courses[0] === undefined) {
      sendError(response, 400, "Course does not exist");
      return;
    }

    const [levels] = await databasePool.execute<ExistingRow[]>(
      `SELECT id
           FROM levels
           WHERE id = ?
             AND is_active = TRUE
           LIMIT 1`,
      [classData.levelId],
    );

    if (levels[0] === undefined) {
      sendError(response, 400, "Active level does not exist");
      return;
    }

    if (
      classData.primaryTeacherId !== null &&
      classData.primaryTeacherId !== undefined
    ) {
      const [teachers] = await databasePool.execute<ExistingRow[]>(
        `SELECT teachers.id
             FROM teachers
             INNER JOIN users
               ON users.id = teachers.user_id
             WHERE teachers.id = ?
               AND users.is_active = TRUE
             LIMIT 1`,
        [classData.primaryTeacherId],
      );

      if (teachers[0] === undefined) {
        sendError(response, 400, "Active teacher does not exist");
        return;
      }
    }

    const [duplicateClasses] = await databasePool.execute<ExistingRow[]>(
      `SELECT id
           FROM classes
           WHERE class_code = ?
           LIMIT 1`,
      [classData.classCode],
    );

    if (duplicateClasses[0] !== undefined) {
      sendError(response, 409, "Class code is already in use");
      return;
    }

    try {
      const [result] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO classes (
              course_id,
              level_id,
              primary_teacher_id,
              class_code,
              class_name,
              status,
              start_date,
              end_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          classData.courseId,
          classData.levelId,
          classData.primaryTeacherId ?? null,
          classData.classCode,
          classData.className,
          classData.status,
          classData.startDate ?? null,
          classData.endDate ?? null,
        ],
      );

      sendSuccess(response, 201, "Class created successfully", {
        classId: result.insertId,
        classCode: classData.classCode,
        status: classData.status,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      ) {
        sendError(response, 409, "Class conflicts with existing data");
        return;
      }

      throw error;
    }
  } catch (error) {
    next(error);
  }
});

adminClassRouter.post(
  "/:classId/members",
  async (request, response, next) => {
    try {
      const classId = Number(request.params.classId);

      if (!Number.isInteger(classId) || classId <= 0) {
        sendError(
          response,
          400,
          "Class ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminAddClassMemberSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid class member data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { enrollmentId } = validationResult.data;
      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [classes] =
          await connection.execute<ClassForMemberRow[]>(
            `SELECT
              id,
              course_id AS courseId,
              level_id AS levelId,
              status
             FROM classes
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [classId],
          );

        const selectedClass = classes[0];

        if (selectedClass === undefined) {
          await connection.rollback();
          sendError(response, 404, "Class not found");
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
            "Cannot add a member to a completed or cancelled class",
          );
          return;
        }

        const [enrollments] =
          await connection.execute<EnrollmentForMemberRow[]>(
            `SELECT
              id,
              student_id AS studentId,
              course_id AS courseId,
              level_id AS levelId,
              status
             FROM enrollments
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [enrollmentId],
          );

        const enrollment = enrollments[0];

        if (enrollment === undefined) {
          await connection.rollback();
          sendError(response, 404, "Enrollment not found");
          return;
        }

        if (enrollment.status !== "ACTIVE") {
          await connection.rollback();

          sendError(
            response,
            409,
            "Enrollment must be active before adding it to a class",
          );
          return;
        }

        if (
          enrollment.courseId !== selectedClass.courseId ||
          enrollment.levelId !== selectedClass.levelId
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Enrollment course and level must match the class",
          );
          return;
        }

        const [activeMemberships] =
          await connection.execute<ClassMemberRow[]>(
            `SELECT
              id,
              class_id AS classId
             FROM class_members
             WHERE enrollment_id = ?
               AND status = 'ACTIVE'
             LIMIT 1
             FOR UPDATE`,
            [enrollmentId],
          );

        const activeMembership = activeMemberships[0];

        if (activeMembership !== undefined) {
          await connection.rollback();

          sendError(
            response,
            409,
            activeMembership.classId === classId
              ? "Enrollment is already active in this class"
              : "Enrollment is already active in another class",
          );
          return;
        }

        const [previousMemberships] =
          await connection.execute<ClassMemberRow[]>(
            `SELECT
              id,
              class_id AS classId
             FROM class_members
             WHERE class_id = ?
               AND enrollment_id = ?
             LIMIT 1
             FOR UPDATE`,
            [classId, enrollmentId],
          );

        const previousMembership = previousMemberships[0];
        let classMemberId: number;
        let reactivated = false;

        if (previousMembership !== undefined) {
          await connection.execute<ResultSetHeader>(
            `UPDATE class_members
             SET status = 'ACTIVE',
                 joined_at = CURRENT_TIMESTAMP,
                 left_at = NULL
             WHERE id = ?`,
            [previousMembership.id],
          );

          classMemberId = previousMembership.id;
          reactivated = true;
        } else {
          const [memberResult] =
            await connection.execute<ResultSetHeader>(
              `INSERT INTO class_members (
                class_id,
                enrollment_id,
                status
              )
              VALUES (?, ?, 'ACTIVE')`,
              [classId, enrollmentId],
            );

          classMemberId = memberResult.insertId;
        }

        await connection.commit();

        sendSuccess(
          response,
          201,
          reactivated
            ? "Class member reactivated successfully"
            : "Class member added successfully",
          {
            classMemberId,
            classId,
            enrollmentId,
            studentId: enrollment.studentId,
            status: "ACTIVE",
            reactivated,
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
            "Enrollment is already assigned to this class",
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

adminClassRouter.patch(
  "/:classId/members/:classMemberId/remove",
  async (request, response, next) => {
    try {
      const classId = Number(request.params.classId);
      const classMemberId =
        Number(request.params.classMemberId);

      if (!Number.isInteger(classId) || classId <= 0) {
        sendError(
          response,
          400,
          "Class ID must be a positive integer",
        );
        return;
      }

      if (
        !Number.isInteger(classMemberId) ||
        classMemberId <= 0
      ) {
        sendError(
          response,
          400,
          "Class member ID must be a positive integer",
        );
        return;
      }

      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [members] =
          await connection.execute<
            ClassMemberForRemovalRow[]
          >(
            `SELECT
              id,
              enrollment_id AS enrollmentId,
              status
             FROM class_members
             WHERE id = ?
               AND class_id = ?
             LIMIT 1
             FOR UPDATE`,
            [classMemberId, classId],
          );

        const member = members[0];

        if (member === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Class member not found",
          );
          return;
        }

        if (member.status !== "ACTIVE") {
          await connection.rollback();

          sendError(
            response,
            409,
            "Class member is not active",
          );
          return;
        }

        await connection.execute<ResultSetHeader>(
          `UPDATE class_members
           SET status = 'LEFT',
               left_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [classMemberId],
        );

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Class member removed successfully",
          {
            classMemberId,
            classId,
            enrollmentId: member.enrollmentId,
            status: "LEFT",
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

adminClassRouter.patch(
  "/:classId/members/:classMemberId/move",
  async (request, response, next) => {
    try {
      const sourceClassId =
        Number(request.params.classId);

      const sourceClassMemberId =
        Number(request.params.classMemberId);

      if (
        !Number.isInteger(sourceClassId) ||
        sourceClassId <= 0
      ) {
        sendError(
          response,
          400,
          "Class ID must be a positive integer",
        );
        return;
      }

      if (
        !Number.isInteger(sourceClassMemberId) ||
        sourceClassMemberId <= 0
      ) {
        sendError(
          response,
          400,
          "Class member ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminMoveClassMemberSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid class movement data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { targetClassId } = validationResult.data;

      if (targetClassId === sourceClassId) {
        sendError(
          response,
          400,
          "Target class must be different from source class",
        );
        return;
      }

      const connection =
        await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [sourceMembers] =
          await connection.execute<
            ClassMemberForRemovalRow[]
          >(
            `SELECT
              id,
              enrollment_id AS enrollmentId,
              status
             FROM class_members
             WHERE id = ?
               AND class_id = ?
             LIMIT 1
             FOR UPDATE`,
            [
              sourceClassMemberId,
              sourceClassId,
            ],
          );

        const sourceMember = sourceMembers[0];

        if (sourceMember === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Source class member not found",
          );
          return;
        }

        if (sourceMember.status !== "ACTIVE") {
          await connection.rollback();

          sendError(
            response,
            409,
            "Source class member is not active",
          );
          return;
        }

        const [targetClasses] =
          await connection.execute<ClassForMemberRow[]>(
            `SELECT
              id,
              course_id AS courseId,
              level_id AS levelId,
              status
             FROM classes
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [targetClassId],
          );

        const targetClass = targetClasses[0];

        if (targetClass === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Target class not found",
          );
          return;
        }

        if (
          targetClass.status === "COMPLETED" ||
          targetClass.status === "CANCELLED"
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Cannot move a member to a completed or cancelled class",
          );
          return;
        }

        const [enrollments] =
          await connection.execute<EnrollmentForMemberRow[]>(
            `SELECT
              id,
              student_id AS studentId,
              course_id AS courseId,
              level_id AS levelId,
              status
             FROM enrollments
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [sourceMember.enrollmentId],
          );

        const enrollment = enrollments[0];

        if (enrollment === undefined) {
          await connection.rollback();

          sendError(
            response,
            404,
            "Enrollment not found",
          );
          return;
        }

        if (enrollment.status !== "ACTIVE") {
          await connection.rollback();

          sendError(
            response,
            409,
            "Enrollment must be active before moving it",
          );
          return;
        }

        if (
          enrollment.courseId !== targetClass.courseId ||
          enrollment.levelId !== targetClass.levelId
        ) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Enrollment course and level must match the target class",
          );
          return;
        }

        const [otherActiveMemberships] =
          await connection.execute<ClassMemberRow[]>(
            `SELECT
              id,
              class_id AS classId
             FROM class_members
             WHERE enrollment_id = ?
               AND status = 'ACTIVE'
               AND id <> ?
             LIMIT 1
             FOR UPDATE`,
            [
              sourceMember.enrollmentId,
              sourceClassMemberId,
            ],
          );

        if (otherActiveMemberships[0] !== undefined) {
          await connection.rollback();

          sendError(
            response,
            409,
            "Enrollment is already active in another class",
          );
          return;
        }

        const [previousTargetMemberships] =
          await connection.execute<ClassMemberRow[]>(
            `SELECT
              id,
              class_id AS classId
             FROM class_members
             WHERE class_id = ?
               AND enrollment_id = ?
             LIMIT 1
             FOR UPDATE`,
            [
              targetClassId,
              sourceMember.enrollmentId,
            ],
          );

        const previousTargetMembership =
          previousTargetMemberships[0];

        await connection.execute<ResultSetHeader>(
          `UPDATE class_members
           SET status = 'LEFT',
               left_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [sourceClassMemberId],
        );

        let targetClassMemberId: number;
        let reactivated = false;

        if (previousTargetMembership !== undefined) {
          await connection.execute<ResultSetHeader>(
            `UPDATE class_members
             SET status = 'ACTIVE',
                 joined_at = CURRENT_TIMESTAMP,
                 left_at = NULL
             WHERE id = ?`,
            [previousTargetMembership.id],
          );

          targetClassMemberId =
            previousTargetMembership.id;

          reactivated = true;
        } else {
          const [targetMemberResult] =
            await connection.execute<ResultSetHeader>(
              `INSERT INTO class_members (
                class_id,
                enrollment_id,
                status
              )
              VALUES (?, ?, 'ACTIVE')`,
              [
                targetClassId,
                sourceMember.enrollmentId,
              ],
            );

          targetClassMemberId =
            targetMemberResult.insertId;
        }

        await connection.commit();

        sendSuccess(
          response,
          200,
          "Class member moved successfully",
          {
            enrollmentId: sourceMember.enrollmentId,
            studentId: enrollment.studentId,
            sourceClassId,
            sourceClassMemberId,
            targetClassId,
            targetClassMemberId,
            status: "ACTIVE",
            reactivated,
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
            "Target class already contains this enrollment",
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
