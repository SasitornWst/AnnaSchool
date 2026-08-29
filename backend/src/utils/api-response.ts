import type { Response } from "express";

export function sendSuccess<T>(
  response: Response,
  statusCode: number,
  message: string,
  data: T | null = null,
): Response {
  return response.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function sendError(
  response: Response,
  statusCode: number,
  message: string,
  errors?: unknown,
): Response {
  return response.status(statusCode).json({
    success: false,
    message,
    data: null,
    ...(errors === undefined ? {} : { errors }),
  });
}