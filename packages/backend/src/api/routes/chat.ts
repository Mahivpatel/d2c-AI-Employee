import { Router } from "express";
import { z } from "zod";

const router = Router();

const ChatRequestSchema = z.object({
  merchantId: z.string().uuid(),
  message: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
});

router.post("/", async (req, res, next) => {
  try {
    const body = ChatRequestSchema.parse(req.body);
    // Full tool-use loop + citation post-processor added Day 4
    res.json({
      response: "Chat layer scaffolded. Tool-use loop coming Day 4.",
      citations: [],
      toolCallsMade: 0,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
