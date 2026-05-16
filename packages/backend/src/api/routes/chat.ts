// ── /api/chat routes ─────────────────────────────────────────────────────────
// POST /api/chat          — synchronous, returns full reply (legacy/curl use)
// GET  /api/chat/stream   — SSE streaming: token | citation | done events

import { Router } from "express";
import { z } from "zod";
import { streamText, stepCountIs } from "ai";
import { getLLM } from "../../chat/config";
import { tools } from "../../chat/tools";
import { systemPrompt } from "../../chat/systemPrompt";
import { runChatLoop } from "../../chat/loop";
import { verifyCitations } from "../../chat/verifyCitations";

const router = Router();

// ── Zod schemas ──────────────────────────────────────────────────────────────

export const ChatRequestSchema = z.object({
  merchantId: z.string().uuid(),
  message:    z.string().min(1).max(2000),
  history:    z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
});

// For GET /stream: history is JSON-encoded in query string
const ChatStreamQuerySchema = z.object({
  merchantId: z.string().uuid(),
  message:    z.string().min(1).max(2000),
  history:    z.string().optional(), // JSON string
});

// ── POST /api/chat — synchronous (for curl / programmatic) ───────────────────

router.post("/", async (req, res, next) => {
  try {
    const body = ChatRequestSchema.parse(req.body);
    const messages = [...body.history, { role: "user" as const, content: body.message }];

    const { text, toolResults } = await runChatLoop(body.merchantId, messages);
    const { verified } = verifyCitations(text ?? "", toolResults);

    res.json({ reply: verified });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/chat/stream — SSE streaming ─────────────────────────────────────
// Browser usage:
//   const es = new EventSource(`/api/chat/stream?merchantId=...&message=...`)
//
// Event types emitted:
//   data: {"type":"token","content":"Hello"}        ← streamed text chunk
//   data: {"type":"citation","factIds":[],"source":"shopify","raw":{}}
//   data: {"type":"done"}

router.get("/stream", async (req, res, next) => {
  try {
    const query = ChatStreamQuerySchema.parse(req.query);

    let history: { role: "user" | "assistant"; content: string }[] = [];
    if (query.history) {
      try {
        history = JSON.parse(query.history);
      } catch {
        /* ignore malformed history */
      }
    }

    const messages = [...history, { role: "user" as const, content: query.message }];

    // ── SSE headers ──────────────────────────────────────────────────────────
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders();

    // Helper to send an SSE event
    const send = (payload: object) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // Accumulate tool results so we can emit citation events
    const allToolResults: any[] = [];

    const result = await streamText({
      model:  getLLM(),
      system: systemPrompt(query.merchantId),
      messages,
      tools,
      experimental_context: { merchantId: query.merchantId },
      stopWhen: stepCountIs(5),
      onChunk: ({ chunk }: any) => {
        if (chunk.type === "text-delta") {
          const content = chunk.text ?? chunk.delta ?? chunk.textDelta ?? "";
          if (content) send({ type: "token", content });
        }
      },
      onStepFinish: ({ toolResults }: any) => {
        if (!Array.isArray(toolResults)) return;
        for (const tr of toolResults) {
          allToolResults.push(tr);
          const output = tr?.output ?? tr;
          // Emit citation events for fact_id arrays
          const factIds: string[] = (
            output?.total_fact_ids ??
            output?.all_fact_ids ??
            output?.fact_ids ??
            []
          ).map(String);

          if (factIds.length > 0) {
            send({
              type:    "citation",
              factIds,
              source:  output?.source ?? "shopify",
              raw:     output,
            });
          }
        }
      },
    } as any);

    // Drain the stream (required by the Vercel AI SDK)
    await result.fullStream.pipeTo(
      new WritableStream({ write() {} })
    ).catch(() => {/* stream may already be consumed */});

    send({ type: "done" });
    res.end();
  } catch (err) {
    next(err);
  }
});

export default router;
