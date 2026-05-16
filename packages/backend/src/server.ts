import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { config } from "./core/config";
import merchantsRouter from "./api/routes/merchants";
import syncRouter      from "./api/routes/sync";
import metricsRouter   from "./api/routes/metrics";
import agentsRouter    from "./api/routes/agents";
import chatRouter      from "./api/routes/chat";

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: config.CONNECTOR_VERSION });
});

app.use("/api/merchants", merchantsRouter);
app.use("/api/sync",      syncRouter);
app.use("/api/metrics",   metricsRouter);
app.use("/api/agents",    agentsRouter);
app.use("/api/chat",      chatRouter);

// ── Global error handler ─────────────────────────────────────────────────────
// ZodError   → 400 with structured validation messages
// Everything else → 500

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    const zodErr = err as ZodError<any>;
    return res.status(400).json({
      error: "Validation error",
      details: zodErr.issues.map((e: any) => ({
        path:    e.path.join("."),
        message: e.message,
      })),
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[server] Unhandled error:", message);
  res.status(500).json({ error: message });
});

app.listen(config.PORT, () => {
  console.log("API running on http://localhost:" + config.PORT);
});

export default app;
