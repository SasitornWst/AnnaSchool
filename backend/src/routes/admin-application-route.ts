import { Router } from "express";
import type { RowDataPacket } from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";

import {
  updateApplicationStatusSchema,
  updateStudentAssessmentSchema,
  type ApplicationStatus,
} from "../validations/application-schema.ts";

interface ApplicationListRow extends RowDataPacket {
  id: number;
  parentTitle: string | null;
  parentFirstName: string;
  parentLastName: string;
  parentPhone: string;
  parentEmail: string | null;
  status: string;
  studentCount: number;
  createdAt: Date;
}

interface ApplicationDetailRow extends RowDataPacket {
  id: number;
  parentId: number | null;
  parentTitle: string | null;
  parentFirstName: string;
  parentLastName: string;
  parentPhone: string;
  parentEmail: string | null;
  parentLineId: string | null;
  parentAddress: string | null;
  status: string;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ApplicationStudentDetailRow extends RowDataPacket {
  id: number;
  studentId: number | null;
  title: string | null;
  firstName: string;
  lastName: string;
  nickname: string | null;
  birthDate: Date;
  schoolName: string | null;
  medicalCondition: string | null;
  interestedCourseId: number | null;
  interestedCourseName: string | null;
  assessedLevelId: number | null;
  assessedLevelName: string | null;
  assessmentNote: string | null;
}

interface ApplicationStatusRow extends RowDataPacket {
  status: ApplicationStatus;
}

interface ApplicationStudentStatusRow extends RowDataPacket {
  applicationStatus: ApplicationStatus;
}

interface ActiveLevelRow extends RowDataPacket {
  id: number;
}

interface UnassessedStudentCountRow extends RowDataPacket {
  unassessedCount: number;
}

const allowedStatusTransitions: Record<
  ApplicationStatus,
  readonly ApplicationStatus[]
> = {
  NEW: ["CONTACTED", "REJECTED"],
  CONTACTED: ["ASSESSED", "REJECTED"],
  ASSESSED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

export const adminApplicationRouter = Router();

adminApplicationRouter.use(authenticate, authorizeRoles("ADMIN"));

adminApplicationRouter.get("/", async (_request, response, next) => {
  try {
    const [applications] = await databasePool.execute<ApplicationListRow[]>(
      `SELECT
            applications.id,
            applications.parent_title AS parentTitle,
            applications.parent_first_name AS parentFirstName,
            applications.parent_last_name AS parentLastName,
            applications.parent_phone AS parentPhone,
            applications.parent_email AS parentEmail,
            applications.status,
            (
              SELECT COUNT(*)
              FROM application_students
              WHERE application_students.application_id = applications.id
            ) AS studentCount,
            applications.created_at AS createdAt
          FROM applications
          ORDER BY applications.created_at DESC,
                   applications.id DESC`,
    );

    sendSuccess(
      response,
      200,
      "Applications retrieved successfully",
      applications,
    );
  } catch (error) {
    next(error);
  }
});

adminApplicationRouter.get(
  "/:applicationId",
  async (request, response, next) => {
    try {
      const applicationId = Number(request.params.applicationId);

      if (!Number.isInteger(applicationId) || applicationId <= 0) {
        sendError(response, 400, "Application ID must be a positive integer");
        return;
      }

      const [applications] = await databasePool.execute<ApplicationDetailRow[]>(
        `SELECT
            id,
            parent_id AS parentId,
            parent_title AS parentTitle,
            parent_first_name AS parentFirstName,
            parent_last_name AS parentLastName,
            parent_phone AS parentPhone,
            parent_email AS parentEmail,
            parent_line_id AS parentLineId,
            parent_address AS parentAddress,
            status,
            admin_note AS adminNote,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM applications
          WHERE id = ?
          LIMIT 1`,
        [applicationId],
      );

      const application = applications[0];

      if (application === undefined) {
        sendError(response, 404, "Application not found");
        return;
      }

      const [students] = await databasePool.execute<
        ApplicationStudentDetailRow[]
      >(
        `SELECT
            application_students.id,
            application_students.student_id AS studentId,
            application_students.title,
            application_students.first_name AS firstName,
            application_students.last_name AS lastName,
            application_students.nickname,
            application_students.birth_date AS birthDate,
            application_students.school_name AS schoolName,
            application_students.medical_condition AS medicalCondition,
            application_students.interested_course_id AS interestedCourseId,
            courses.name AS interestedCourseName,
            application_students.assessed_level_id AS assessedLevelId,
            levels.name AS assessedLevelName,
            application_students.assessment_note AS assessmentNote
          FROM application_students
          LEFT JOIN courses
            ON courses.id =
               application_students.interested_course_id
          LEFT JOIN levels
            ON levels.id =
               application_students.assessed_level_id
          WHERE application_students.application_id = ?
          ORDER BY application_students.id ASC`,
        [applicationId],
      );

      sendSuccess(response, 200, "Application retrieved successfully", {
        application,
        students,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminApplicationRouter.patch(
  "/:applicationId/status",
  async (request, response, next) => {
    try {
      const applicationId = Number(request.params.applicationId);

      if (!Number.isInteger(applicationId) || applicationId <= 0) {
        sendError(response, 400, "Application ID must be a positive integer");
        return;
      }

      const validationResult = updateApplicationStatusSchema.safeParse(
        request.body,
      );

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid application status data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { status: newStatus, adminNote } = validationResult.data;

      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [applications] = await connection.execute<ApplicationStatusRow[]>(
          `SELECT status
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

        const currentStatus = application.status;
        const allowedStatuses = allowedStatusTransitions[currentStatus];

        if (!allowedStatuses.includes(newStatus)) {
          await connection.rollback();

          sendError(
            response,
            409,
            `Cannot change application status from ${currentStatus} to ${newStatus}`,
          );
          return;
        }

        if (newStatus === "ASSESSED") {
          const [studentCounts] = await connection.execute<
            UnassessedStudentCountRow[]
          >(
            `SELECT COUNT(*) AS unassessedCount
       FROM application_students
       WHERE application_id = ?
         AND assessed_level_id IS NULL`,
            [applicationId],
          );

          const unassessedCount = studentCounts[0]?.unassessedCount ?? 0;

          if (unassessedCount > 0) {
            await connection.rollback();

            sendError(
              response,
              409,
              "All students must be assessed before changing status to ASSESSED",
            );
            return;
          }
        }

        if (adminNote === undefined) {
          await connection.execute(
            `UPDATE applications
             SET status = ?
             WHERE id = ?`,
            [newStatus, applicationId],
          );
        } else {
          await connection.execute(
            `UPDATE applications
             SET status = ?, admin_note = ?
             WHERE id = ?`,
            [newStatus, adminNote, applicationId],
          );
        }

        await connection.commit();

        sendSuccess(response, 200, "Application status updated successfully", {
          applicationId,
          previousStatus: currentStatus,
          status: newStatus,
        });
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

adminApplicationRouter.patch(
  "/:applicationId/students/:applicationStudentId/assessment",
  async (request, response, next) => {
    try {
      const applicationId = Number(request.params.applicationId);
      const applicationStudentId = Number(request.params.applicationStudentId);

      if (
        !Number.isInteger(applicationId) ||
        applicationId <= 0 ||
        !Number.isInteger(applicationStudentId) ||
        applicationStudentId <= 0
      ) {
        sendError(
          response,
          400,
          "Application and application student IDs must be positive integers",
        );
        return;
      }

      const validationResult = updateStudentAssessmentSchema.safeParse(
        request.body,
      );

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid student assessment data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { assessedLevelId, assessmentNote } = validationResult.data;

      const connection = await databasePool.getConnection();

      try {
        await connection.beginTransaction();

        const [applicationStudents] = await connection.execute<
          ApplicationStudentStatusRow[]
        >(
          `SELECT
              applications.status AS applicationStatus
            FROM application_students
            INNER JOIN applications
              ON applications.id =
                 application_students.application_id
            WHERE applications.id = ?
              AND application_students.id = ?
            LIMIT 1
            FOR UPDATE`,
          [applicationId, applicationStudentId],
        );

        const applicationStudent = applicationStudents[0];

        if (applicationStudent === undefined) {
          await connection.rollback();
          sendError(response, 404, "Application student not found");
          return;
        }

        if (
          applicationStudent.applicationStatus !== "CONTACTED" &&
          applicationStudent.applicationStatus !== "ASSESSED"
        ) {
          await connection.rollback();
          sendError(
            response,
            409,
            "Application must be CONTACTED before assessment",
          );
          return;
        }

        const [levels] = await connection.execute<ActiveLevelRow[]>(
          `SELECT id
             FROM levels
             WHERE id = ?
               AND is_active = TRUE
             LIMIT 1`,
          [assessedLevelId],
        );

        if (levels[0] === undefined) {
          await connection.rollback();
          sendError(response, 400, "Assessed level is unavailable");
          return;
        }

        if (assessmentNote === undefined) {
          await connection.execute(
            `UPDATE application_students
             SET assessed_level_id = ?
             WHERE id = ?`,
            [assessedLevelId, applicationStudentId],
          );
        } else {
          await connection.execute(
            `UPDATE application_students
             SET assessed_level_id = ?,
                 assessment_note = ?
             WHERE id = ?`,
            [assessedLevelId, assessmentNote, applicationStudentId],
          );
        }

        await connection.commit();

        sendSuccess(response, 200, "Student assessment updated successfully", {
          applicationId,
          applicationStudentId,
          assessedLevelId,
        });
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
