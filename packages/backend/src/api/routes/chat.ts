import { Router } from "express";
import { z } from "zod";
import { runChatLoop } from "../../chat/loop";
import { verifyCitations } from "../../chat/verifyCitations";

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
    
    // Combine history and current message
    const messages = [...body.history, { role: "user", content: body.message }];

    // Run the chat loop
    const { text, toolResults } = await runChatLoop(body.merchantId, messages);
    
    // Verify citations
    const { verified } = verifyCitations(text ?? '', toolResults);

    // Optional: save to database if saveChatTurn is implemented
    // await db.saveChatTurn({ merchantId: body.merchantId, messages, response: verified });

    res.json({ reply: verified });
  } catch (err) {
    next(err);
  }
});

export default router;
