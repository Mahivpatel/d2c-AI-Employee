import { useState, useCallback, useEffect, useRef } from 'react';
import { openChatStream, type SSEEvent, type ChatMessage } from '../api/client';

export interface Citation {
  id:      string;   // unique key
  factIds: string[];
  source:  string;
  raw:     unknown;
}

export interface DisplayMessage {
  role:      'user' | 'assistant';
  content:   string;
  citations: Citation[];
  streaming: boolean;
}

export function useSSEChat(merchantId: string | null) {
  const [messages, setMessages]   = useState<DisplayMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    esRef.current?.close();
    esRef.current = null;
    setMessages([]);
    setStreaming(false);
  }, [merchantId]);

  const send = useCallback((text: string) => {
    if (!merchantId || streaming) return;

    // Append user message
    const historyForApi: ChatMessage[] = messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, citations: [], streaming: false },
      { role: 'assistant', content: '', citations: [], streaming: true },
    ]);
    setStreaming(true);

    const citeCounter = { n: 0 };

    const es = openChatStream(
      merchantId,
      text,
      historyForApi,
      (event: SSEEvent) => {
        if (event.type === 'token') {
          if (!event.content) return;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + event.content };
            }
            return next;
          });
        } else if (event.type === 'citation') {
          const citeId = `cite-${++citeCounter.n}`;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                citations: [
                  ...last.citations,
                  { id: citeId, factIds: event.factIds, source: event.source, raw: event.raw },
                ],
              };
            }
            return next;
          });
        } else if (event.type === 'done') {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last.role === 'assistant') {
              next[next.length - 1] = { ...last, streaming: false };
            }
            return next;
          });
          setStreaming(false);
          esRef.current = null;
        }
      },
      () => {
        es.close();
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: last.content || 'Sorry, the chat stream failed. Please try again.',
              streaming: false,
            };
          }
          return next;
        });
        setStreaming(false);
        esRef.current = null;
      },
    );

    esRef.current = es;
  }, [merchantId, messages, streaming]);

  const reset = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setMessages([]);
    setStreaming(false);
  }, []);

  return { messages, streaming, send, reset };
}
