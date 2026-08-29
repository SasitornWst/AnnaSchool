import type { ErrorRequestHandler } from "express";
import { sendError } from "../utils/api-response.ts";

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  console.error(error);

  sendError(response, 500, "Internal server error");
};