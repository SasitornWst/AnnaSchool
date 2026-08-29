import type { RequestHandler } from "express";

import { sendError } from "../utils/api-response.ts";
import type { AuthTokenPayload } from "../utils/jwt.ts";

export function authorizeRoles(
  ...allowedRoles: string[]
): RequestHandler {
  return (_request, response, next) => {
    const authenticatedUser: AuthTokenPayload | undefined =
      response.locals.auth;

    if (authenticatedUser === undefined) {
      sendError(response, 401, "Authentication is required");
      return;
    }

    if (!allowedRoles.includes(authenticatedUser.role)) {
      sendError(response, 403, "You do not have permission");
      return;
    }

    next();
  };
}