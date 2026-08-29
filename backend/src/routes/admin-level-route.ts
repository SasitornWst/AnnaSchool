import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { databasePool } from "../config/database.ts";
import { authenticate } from "../middlewares/authenticate.ts";
import { authorizeRoles } from "../middlewares/authorize-role.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import { adminCreateLevelSchema, adminUpdateLevelSchema, } from "../validations/level-schema.ts";

interface ExistingLevelRow extends RowDataPacket {
  id: number;
}

interface AdminLevelRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CurrentLevelRow extends RowDataPacket {
  id: number;
  name: string;
}

export const adminLevelRouter = Router();

adminLevelRouter.use(authenticate, authorizeRoles("ADMIN"));

adminLevelRouter.post("/", async (request, response, next) => {
  try {
    const validationResult = adminCreateLevelSchema.safeParse(request.body);

    if (!validationResult.success) {
      sendError(
        response,
        400,
        "Invalid level data",
        validationResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
      return;
    }

    const levelData = validationResult.data;

    const [existingLevels] = await databasePool.execute<ExistingLevelRow[]>(
      `SELECT id
           FROM levels
           WHERE name = ?
           LIMIT 1`,
      [levelData.name],
    );

    if (existingLevels[0] !== undefined) {
      sendError(response, 409, "Level name is already in use");
      return;
    }

    try {
      const [result] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO levels (
              name,
              description,
              sort_order,
              is_active
            )
            VALUES (?, ?, ?, ?)`,
        [
          levelData.name,
          levelData.description === "" ? null : (levelData.description ?? null),
          levelData.sortOrder,
          levelData.isActive,
        ],
      );

      sendSuccess(response, 201, "Level created successfully", {
        levelId: result.insertId,
        name: levelData.name,
        sortOrder: levelData.sortOrder,
        isActive: levelData.isActive,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      ) {
        sendError(response, 409, "Level conflicts with existing data");
        return;
      }

      throw error;
    }
  } catch (error) {
    next(error);
  }
});

adminLevelRouter.get("/", async (_request, response, next) => {
  try {
    const [levels] = await databasePool.execute<AdminLevelRow[]>(
      `SELECT
            id,
            name,
            description,
            sort_order AS sortOrder,
            is_active AS isActive,
            created_at AS createdAt,
            updated_at AS updatedAt
           FROM levels
           ORDER BY sort_order ASC, name ASC, id ASC`,
    );

    sendSuccess(
      response,
      200,
      "Levels retrieved successfully",
      levels.map((level) => ({
        ...level,
        isActive: level.isActive === 1,
      })),
    );
  } catch (error) {
    next(error);
  }
});

adminLevelRouter.get("/:levelId", async (request, response, next) => {
  try {
    const levelId = Number(request.params.levelId);

    if (!Number.isInteger(levelId) || levelId <= 0) {
      sendError(response, 400, "Level ID must be a positive integer");
      return;
    }

    const [levels] = await databasePool.execute<AdminLevelRow[]>(
      `SELECT
            id,
            name,
            description,
            sort_order AS sortOrder,
            is_active AS isActive,
            created_at AS createdAt,
            updated_at AS updatedAt
           FROM levels
           WHERE id = ?
           LIMIT 1`,
      [levelId],
    );

    const level = levels[0];

    if (level === undefined) {
      sendError(response, 404, "Level not found");
      return;
    }

    sendSuccess(response, 200, "Level retrieved successfully", {
      ...level,
      isActive: level.isActive === 1,
    });
  } catch (error) {
    next(error);
  }
});

adminLevelRouter.patch(
  "/:levelId",
  async (request, response, next) => {
    try {
      const levelId = Number(request.params.levelId);

      if (!Number.isInteger(levelId) || levelId <= 0) {
        sendError(
          response,
          400,
          "Level ID must be a positive integer",
        );
        return;
      }

      const validationResult =
        adminUpdateLevelSchema.safeParse(request.body);

      if (!validationResult.success) {
        sendError(
          response,
          400,
          "Invalid level data",
          validationResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
        return;
      }

      const levelData = validationResult.data;

      const [levels] =
        await databasePool.execute<CurrentLevelRow[]>(
          `SELECT id, name
           FROM levels
           WHERE id = ?
           LIMIT 1`,
          [levelId],
        );

      const currentLevel = levels[0];

      if (currentLevel === undefined) {
        sendError(response, 404, "Level not found");
        return;
      }

      if (
        levelData.name !== undefined &&
        levelData.name !== currentLevel.name
      ) {
        const [duplicateLevels] =
          await databasePool.execute<ExistingLevelRow[]>(
            `SELECT id
             FROM levels
             WHERE name = ?
               AND id <> ?
             LIMIT 1`,
            [levelData.name, levelId],
          );

        if (duplicateLevels[0] !== undefined) {
          sendError(
            response,
            409,
            "Level name is already in use",
          );
          return;
        }
      }

      const updateFields: string[] = [];
      const updateValues: Array<string | number | boolean | null> = [];

      if (levelData.name !== undefined) {
        updateFields.push("name = ?");
        updateValues.push(levelData.name);
      }

      if ("description" in levelData) {
        updateFields.push("description = ?");
        updateValues.push(
          levelData.description === ""
            ? null
            : levelData.description ?? null,
        );
      }

      if (levelData.sortOrder !== undefined) {
        updateFields.push("sort_order = ?");
        updateValues.push(levelData.sortOrder);
      }

      if (levelData.isActive !== undefined) {
        updateFields.push("is_active = ?");
        updateValues.push(levelData.isActive);
      }

      updateValues.push(levelId);

      try {
        await databasePool.execute<ResultSetHeader>(
          `UPDATE levels
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
          sendError(
            response,
            409,
            "Level conflicts with existing data",
          );
          return;
        }

        throw error;
      }

      sendSuccess(
        response,
        200,
        "Level updated successfully",
        {
          levelId,
          updatedFields: Object.keys(levelData),
        },
      );
    } catch (error) {
      next(error);
    }
  },
);
