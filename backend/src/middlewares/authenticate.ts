import type { RequestHandler } from "express";

import { sendError } from "../utils/api-response.ts";
import { verifyAccessToken } from "../utils/jwt.ts";

export const authenticate: RequestHandler = async (
  request,
  response,
  next,
) => {
  const authorizationHeader = request.header("authorization");

  if (
    authorizationHeader === undefined ||
    !authorizationHeader.startsWith("Bearer ")
  ) {
    sendError(response, 401, "Authentication token is required");
    return;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();

  if (token === "") {
    sendError(response, 401, "Authentication token is required");
    return;
  }

  try {
    const authenticatedUser = await verifyAccessToken(token);

    response.locals.auth = authenticatedUser;
    next();
  } catch {
    sendError(response, 401, "Invalid or expired authentication token");
  }
};