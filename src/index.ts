import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { auditLogsRouter } from "./routes/auditLogs.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { connectDb } from "./db.js";
import { candidatesRouter } from "./routes/candidates.js";
import { jobsRouter } from "./routes/jobs.js";
import { integrationsRouter } from "./routes/integrations.js";
import { notesRouter } from "./routes/notes.js";
import { reviewsRouter } from "./routes/reviews.js";
import { screenRouter } from "./routes/screen.js";
import { usersRouter } from "./routes/users.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "src/uploads");

fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors({
  origin(origin, callback) {
    if (!origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/audit-logs", auditLogsRouter);
app.use("/api/users", usersRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/candidates/:id/notes", notesRouter);
app.use("/api/candidates/:id/reviews", reviewsRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/screen-cv", screenRouter);

connectDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Hiremind backend listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB", error);
    process.exit(1);
  });
