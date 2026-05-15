import express from "express";
import cors from "cors";
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

app.listen(config.PORT, () => {
  console.log("API running on http://localhost:" + config.PORT);
});

export default app;
