import { Router } from "express";
import type { RowDataPacket } from "mysql2";

import { databasePool } from "../config/database.ts";
import { sendError, sendSuccess } from "../utils/api-response.ts";
import { hashPassword, verifyPassword } from "../utils/password.ts";
import {
  createAccessToken,
  type AuthTokenPayload,
} from "../utils/jwt.ts";
import { authenticate } from "../middlewares/authenticate.ts";

// import { authorizeRoles } from "../middlewares/authorize-role.ts";

interface LoginUserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
  is_active: number;
  role_name: string;
}

interface PasswordUserRow extends RowDataPacket {
  password_hash: string;
  is_active: number;
}

export const authRouter = Router();

authRouter.get("/me", authenticate, (_request, response) => {
  sendSuccess(
    response,
    200,
    "Authenticated user",
    response.locals.auth,
  );
});



authRouter.post("/login", async (request, response, next) => {
  try {
    const requestBody: unknown = request.body;

    if (typeof requestBody !== "object" || requestBody === null) {
      sendError(response, 400, "Username and password are required");
      return;
    }

    const { username, password } = requestBody as Record<string, unknown>;

    if (
      typeof username !== "string" ||
      username.trim() === "" ||
      typeof password !== "string" ||
      password === ""
    ) {
      sendError(response, 400, "Username and password are required");
      return;
    }

    const [users] = await databasePool.execute<LoginUserRow[]>(
      `SELECT
        users.id,
        users.username,
        users.password_hash,
        users.is_active,
        roles.name AS role_name
      FROM users
      INNER JOIN roles ON roles.id = users.role_id
      WHERE users.username = ?
      LIMIT 1`,
      [username.trim()],
    );

    const user = users[0];

    if (user === undefined) {
      sendError(response, 401, "Invalid username or password");
      return;
    }

    const passwordIsCorrect = await verifyPassword(
      password,
      user.password_hash,
    );

    if (!passwordIsCorrect) {
      sendError(response, 401, "Invalid username or password");
      return;
    }

    if (!Boolean(user.is_active)) {
      sendError(response, 403, "Account is inactive");
      return;
    }

    const accessToken = await createAccessToken({
      userId: user.id,
      username: user.username,
      role: user.role_name,
    });

    sendSuccess(response, 200, "Login successful", {
      accessToken,
      tokenType: "Bearer",
      user: {
        id: user.id,
        username: user.username,
        role: user.role_name,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", authenticate, (_request, response) => {
  sendSuccess(response, 200, "Logout successful");
});

authRouter.patch(
  "/password",
  authenticate,
  async (request, response, next) => {
    try {
      const requestBody: unknown = request.body;

      if (typeof requestBody !== "object" || requestBody === null) {
        sendError(
          response,
          400,
          "Current password and new password are required",
        );
        return;
      }

      const { currentPassword, newPassword } =
        requestBody as Record<string, unknown>;

      if (
        typeof currentPassword !== "string" ||
        typeof newPassword !== "string" ||
        currentPassword === "" ||
        newPassword === ""
      ) {
        sendError(
          response,
          400,
          "Current password and new password are required",
        );
        return;
      }

      if (
        newPassword.length < 8 ||
        Buffer.byteLength(newPassword, "utf8") > 72
      ) {
        sendError(
          response,
          400,
          "New password must contain 8-72 bytes",
        );
        return;
      }

      if (currentPassword === newPassword) {
        sendError(
          response,
          400,
          "New password must be different from current password",
        );
        return;
      }

      const authenticatedUser =
        response.locals.auth as AuthTokenPayload;

      const [users] = await databasePool.execute<PasswordUserRow[]>(
        `SELECT password_hash, is_active
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [authenticatedUser.userId],
      );

      const user = users[0];

      if (user === undefined || !Boolean(user.is_active)) {
        sendError(response, 401, "Account is unavailable");
        return;
      }

      const currentPasswordIsCorrect = await verifyPassword(
        currentPassword,
        user.password_hash,
      );

      if (!currentPasswordIsCorrect) {
        sendError(response, 400, "Current password is incorrect");
        return;
      }

      const newPasswordHash = await hashPassword(newPassword);

      await databasePool.execute(
        `UPDATE users
         SET password_hash = ?
         WHERE id = ?`,
        [newPasswordHash, authenticatedUser.userId],
      );

      sendSuccess(response, 200, "Password changed successfully");
    } catch (error) {
      next(error);
    }
  },
);
