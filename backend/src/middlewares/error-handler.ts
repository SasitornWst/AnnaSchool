import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { sendError } from "../utils/api-response.ts";

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      sendError(
        response,
        413,
        "Payment proof file must not exceed 20 MB",
      );
      return;
    }

    sendError(
      response,
      400,
      "Invalid payment proof upload",
      { code: error.code },
    );
    return;
  }

  console.error(error);

  sendError(response, 500, "Internal server error");
};
