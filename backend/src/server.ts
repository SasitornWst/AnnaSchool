import cors from "cors";
import express from "express";
import { errorHandler } from "./middlewares/error-handler.ts";
import { databasePool } from "./config/database.ts";
import { sendError, sendSuccess } from "./utils/api-response.ts";
import { authRouter } from "./routes/auth-route.ts";
import { publicRouter } from "./routes/public-route.ts";
import { adminApplicationRouter } from "./routes/admin-application-route.ts";
import { adminParentRouter } from "./routes/admin-parent-route.ts";
import { adminTeacherRouter } from "./routes/admin-teacher-route.ts";
import { teacherRouter } from "./routes/teacher-route.ts";
import { adminCourseRouter } from "./routes/admin-course-route.ts";
import { adminLevelRouter } from "./routes/admin-level-route.ts";
import { adminClassRouter } from "./routes/admin-class-route.ts";
import { adminEnrollmentRouter } from "./routes/admin-enrollment-route.ts";
import { adminScheduleRouter } from "./routes/admin-schedule-route.ts";
import { parentRouter } from "./routes/parent-route.ts";
import { adminStudentRouter } from "./routes/admin-student-route.ts";
import { adminPaymentRouter } from "./routes/admin-payment-route.ts";
import { parentPaymentRouter } from "./routes/parent-payment-route.ts";

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
app.use("/api/auth", authRouter);
app.use("/api/public", publicRouter);
app.use("/api/admin/applications", adminApplicationRouter);
app.use("/api/admin/parents", adminParentRouter);
app.use("/api/admin/teachers", adminTeacherRouter);
app.use("/api/admin/courses", adminCourseRouter);
app.use("/api/admin/levels", adminLevelRouter);
app.use("/api/admin/classes", adminClassRouter);
app.use("/api/admin/enrollments", adminEnrollmentRouter);
app.use("/api/admin/schedules", adminScheduleRouter);
app.use("/api/admin/students", adminStudentRouter);
app.use("/api/admin/payments", adminPaymentRouter);
app.use("/api/teacher", teacherRouter);
app.use("/api/parent", parentRouter);
app.use("/api/parent/payments", parentPaymentRouter);

// ทดสอบ server
app.get("/api/health", (_request, response) => {
  sendSuccess(response, 200, "Server is running");
});

// ทดสอบ database
app.get("/api/health/database", async (_request, response, next) => {
  try {
    const [rows] = await databasePool.execute("SELECT 1 AS connected");

    sendSuccess(response, 200, "Database is connected", rows);
  } catch (error) {
    next(error);
  }
});

app.use((_request, response) => {
  sendError(response, 404, "Route not found");
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
