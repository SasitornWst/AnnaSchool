import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import {
  adminCreateCourseSchema,
  adminUpdateCourseSchema,
  adminUpdateCourseStatusSchema,
} from "../validations/course-schema.ts";

interface ExistingCourseRow extends RowDataPacket {
  id: number;
}

interface AdminCourseRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  recommendedMinAge: number | null;
  recommendedMaxAge: number | null;
  price: string;
  totalMinutes: number;
  promotionText: string | null;
  imagePath: string | null;
  isOpen: number;
  createdAt: Date;
  updatedAt: Date;
}

export const adminCourseRouter = Router();

adminCourseRouter.use(authenticate, authorizeRoles("ADMIN"));

adminCourseRouter.post("/", async (request, response, next) => {
  try {
    const validationResult = adminCreateCourseSchema.safeParse(request.body);

    if (!validationResult.success) {
      sendError(
        response,
        400,
        "Invalid course data",
        validationResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
      return;
    }

    const courseData = validationResult.data;

    const [existingCourses] = await databasePool.execute<ExistingCourseRow[]>(
      `SELECT id
           FROM courses
           WHERE name = ?
           LIMIT 1`,
      [courseData.name],
    );

    if (existingCourses[0] !== undefined) {
      sendError(response, 409, "Course name is already in use");
      return;
    }

    try {
      const [result] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO courses (
              name,
              description,
              recommended_min_age,
              recommended_max_age,
              price,
              total_minutes,
              promotion_text,
              image_path,
              is_open
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          courseData.name,
          courseData.description === ""
            ? null
            : (courseData.description ?? null),
          courseData.recommendedMinAge ?? null,
          courseData.recommendedMaxAge ?? null,
          courseData.price,
          courseData.totalMinutes,
          courseData.promotionText === ""
            ? null
            : (courseData.promotionText ?? null),
          courseData.imagePath === "" ? null : (courseData.imagePath ?? null),
          courseData.isOpen,
        ],
      );

      sendSuccess(response, 201, "Course created successfully", {
        courseId: result.insertId,
        name: courseData.name,
        isOpen: courseData.isOpen,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      ) {
        sendError(response, 409, "Course conflicts with existing data");
        return;
      }

      throw error;
    }
  } catch (error) {
    next(error);
  }
});

adminCourseRouter.get("/", async (_request, response, next) => {
  try {
    const [courses] = await databasePool.execute<AdminCourseRow[]>(
      `SELECT
            id,
            name,
            description,
            recommended_min_age AS recommendedMinAge,
            recommended_max_age AS recommendedMaxAge,
            price,
            total_minutes AS totalMinutes,
            promotion_text AS promotionText,
            image_path AS imagePath,
            is_open AS isOpen,
            created_at AS createdAt,
            updated_at AS updatedAt
           FROM courses
           ORDER BY created_at DESC, id DESC`,
    );

    sendSuccess(
      response,
      200,
      "Courses retrieved successfully",
      courses.map((course) => ({
        ...course,
        isOpen: course.isOpen === 1,
      })),
    );
  } catch (error) {
    next(error);
  }
});

adminCourseRouter.get("/:courseId", async (request, response, next) => {
  try {
    const courseId = Number(request.params.courseId);

    if (!Number.isInteger(courseId) || courseId <= 0) {
      sendError(response, 400, "Course ID must be a positive integer");
      return;
    }

    const [courses] = await databasePool.execute<AdminCourseRow[]>(
      `SELECT
            id,
            name,
            description,
            recommended_min_age AS recommendedMinAge,
            recommended_max_age AS recommendedMaxAge,
            price,
            total_minutes AS totalMinutes,
            promotion_text AS promotionText,
            image_path AS imagePath,
            is_open AS isOpen,
            created_at AS createdAt,
            updated_at AS updatedAt
           FROM courses
           WHERE id = ?
           LIMIT 1`,
      [courseId],
    );

    const course = courses[0];

    if (course === undefined) {
      sendError(response, 404, "Course not found");
      return;
    }

    sendSuccess(response, 200, "Course retrieved successfully", {
      ...course,
      isOpen: course.isOpen === 1,
    });
  } catch (error) {
    next(error);
  }
});

adminCourseRouter.patch("/:courseId", async (request, response, next) => {
  try {
    const courseId = Number(request.params.courseId);

    if (!Number.isInteger(courseId) || courseId <= 0) {
      sendError(response, 400, "Course ID must be a positive integer");
      return;
    }

    const validationResult = adminUpdateCourseSchema.safeParse(request.body);

    if (!validationResult.success) {
      sendError(
        response,
        400,
        "Invalid course data",
        validationResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
      return;
    }

    const courseData = validationResult.data;

    const [courses] = await databasePool.execute<AdminCourseRow[]>(
      `SELECT
            id,
            name,
            description,
            recommended_min_age AS recommendedMinAge,
            recommended_max_age AS recommendedMaxAge,
            price,
            total_minutes AS totalMinutes,
            promotion_text AS promotionText,
            image_path AS imagePath,
            is_open AS isOpen,
            created_at AS createdAt,
            updated_at AS updatedAt
           FROM courses
           WHERE id = ?
           LIMIT 1`,
      [courseId],
    );

    const existingCourse = courses[0];

    if (existingCourse === undefined) {
      sendError(response, 404, "Course not found");
      return;
    }

    const resultingMinAge =
      courseData.recommendedMinAge !== undefined
        ? courseData.recommendedMinAge
        : existingCourse.recommendedMinAge;

    const resultingMaxAge =
      courseData.recommendedMaxAge !== undefined
        ? courseData.recommendedMaxAge
        : existingCourse.recommendedMaxAge;

    if (
      resultingMinAge !== null &&
      resultingMaxAge !== null &&
      resultingMinAge > resultingMaxAge
    ) {
      sendError(
        response,
        400,
        "Recommended maximum age must be greater than or equal to minimum age",
      );
      return;
    }

    if (
      courseData.name !== undefined &&
      courseData.name !== existingCourse.name
    ) {
      const [duplicateCourses] = await databasePool.execute<
        ExistingCourseRow[]
      >(
        `SELECT id
             FROM courses
             WHERE name = ?
               AND id <> ?
             LIMIT 1`,
        [courseData.name, courseId],
      );

      if (duplicateCourses[0] !== undefined) {
        sendError(response, 409, "Course name is already in use");
        return;
      }
    }

    const updateFields: string[] = [];
    const updateValues: Array<string | number | null> = [];

    if (courseData.name !== undefined) {
      updateFields.push("name = ?");
      updateValues.push(courseData.name);
    }

    if ("description" in courseData) {
      updateFields.push("description = ?");
      updateValues.push(
        courseData.description === "" ? null : (courseData.description ?? null),
      );
    }

    if ("recommendedMinAge" in courseData) {
      updateFields.push("recommended_min_age = ?");
      updateValues.push(courseData.recommendedMinAge ?? null);
    }

    if ("recommendedMaxAge" in courseData) {
      updateFields.push("recommended_max_age = ?");
      updateValues.push(courseData.recommendedMaxAge ?? null);
    }

    if (courseData.price !== undefined) {
      updateFields.push("price = ?");
      updateValues.push(courseData.price);
    }

    if (courseData.totalMinutes !== undefined) {
      updateFields.push("total_minutes = ?");
      updateValues.push(courseData.totalMinutes);
    }

    if ("promotionText" in courseData) {
      updateFields.push("promotion_text = ?");
      updateValues.push(
        courseData.promotionText === ""
          ? null
          : (courseData.promotionText ?? null),
      );
    }

    if ("imagePath" in courseData) {
      updateFields.push("image_path = ?");
      updateValues.push(
        courseData.imagePath === "" ? null : (courseData.imagePath ?? null),
      );
    }

    updateValues.push(courseId);

    try {
      await databasePool.execute<ResultSetHeader>(
        `UPDATE courses
           SET ${updateFields.join(", ")}
           WHERE id = ?`,
        updateValues,
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      ) {
        sendError(response, 409, "Course conflicts with existing data");
        return;
      }

      throw error;
    }

    sendSuccess(response, 200, "Course updated successfully", {
      courseId,
      updatedFields: Object.keys(courseData),
    });
  } catch (error) {
    next(error);
  }
});

adminCourseRouter.patch(
  "/:courseId/status",
  async (request, response, next) => {
    try {
      const courseId = Number(request.params.courseId);

      if (!Number.isInteger(courseId) || courseId <= 0) {
        sendError(
          response,
          400,
          "Course ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminUpdateCourseStatusSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid course status",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const { isOpen } = validationResult.data;

      const [courses] =
        await databasePool.execute<ExistingCourseRow[]>(
          `SELECT id
           FROM courses
           WHERE id = ?
           LIMIT 1`,
          [courseId],
        );

      if (courses[0] === undefined) {
        sendError(response, 404, "Course not found");
        return;
      }

      await databasePool.execute<ResultSetHeader>(
        `UPDATE courses
         SET is_open = ?
         WHERE id = ?`,
        [isOpen, courseId],
      );

      sendSuccess(
        response,
        200,
        isOpen
          ? "Course enrollment opened successfully"
          : "Course enrollment closed successfully",
        {
          courseId,
          isOpen,
        },
      );
    } catch (error) {
      next(error);
    }
  },
);
