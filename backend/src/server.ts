import cors from "cors";
import express from "express";
import { errorHandler } from "./middlewares/error-handler.ts";

import { databasePool } from "./config/database.ts";

const serverPort = Number(process.env.PORT);
const corsOrigin = process.env.CORS_ORIGIN;

if (!Number.isInteger(serverPort)) {
  throw new Error("PORT must be an integer");
}

if (corsOrigin === undefined) {
  throw new Error("Missing environment variable: CORS_ORIGIN");
}

const app = express();

app.use(
  cors({
    origin: corsOrigin,
  }),
);

app.use(express.json());
app.use(errorHandler);

// ทดสอบ server
app.get("/api/health", (_request, response) => {
  response.status(200).json({
    success: true,
    message: "Server is running",
  });
});

// ทดสอบ database
app.get("/api/health/database", async (_request, response, next) => {
  try {
    const [rows] = await databasePool.execute("SELECT 1 AS connected");

    response.status(200).json({
      success: true,
      message: "Database is connected",
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/health/error", () => {
  throw new Error("Test error handling");
});
app.use(errorHandler);

async function startServer(): Promise<void> {
  try {
    const connection = await databasePool.getConnection();

    try {
      await connection.ping();
    } finally {
      connection.release();
    }

    console.log("Database connected successfully");

    app.listen(serverPort, () => {
      console.log(`Server running on http://localhost:${serverPort}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    await databasePool.end();
    process.exitCode = 1;
  }
}

void startServer();
