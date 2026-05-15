import { createGroq } from '@ai-sdk/groq';
import type { LanguageModelV3 } from '@ai-sdk/provider';

export function getLLM(): LanguageModelV3 {
  if (process.env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq('openai/gpt-oss-120b');
    // For prod, switch to:
    // return groq('gemini-1.5-flash');
  }
  throw new Error("LLM provider not configured. Please set GROQ_API_KEY.");
}
