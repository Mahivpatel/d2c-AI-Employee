// ── Groq SDK client ───────────────────────────────────────────────────────────
import Groq from 'groq-sdk';

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is not set in environment variables');
}

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const GROQ_MODEL = 'openai/gpt-oss-120b';
