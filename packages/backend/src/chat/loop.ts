import { generateText, stepCountIs } from 'ai';
import { getLLM }        from './config';
import { tools }         from './tools';
import { systemPrompt }  from './systemPrompt';

export async function runChatLoop(merchantId: string, messages: any[]) {
  const result = await generateText({
    model:    getLLM(),
    system:   systemPrompt(merchantId),
    messages,
    tools,
    experimental_context: { merchantId },
    stopWhen: stepCountIs(5),
    onStepFinish: ({ toolCalls, toolResults }: any) => {
      console.log('Step:', {
        tools: toolCalls?.map((t: any) => t.toolName) ?? [],
        results: toolResults?.length ?? 0,
      });
    },
  } as any);

  const toolResults = result.steps.flatMap((step: any) => step.toolResults ?? []);

  return {
    text: result.text,
    steps: result.steps,
    toolCalls: result.toolCalls,
    toolResults,
  };
}
