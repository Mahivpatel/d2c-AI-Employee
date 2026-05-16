import { useRef, useEffect, useState } from 'react';
import { PaperAirplaneIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useSSEChat, type DisplayMessage } from '../hooks/useSSEChat';
import { CitationChip } from '../components/CitationChip';
import type { Merchant } from '../api/client';

interface Props {
  merchantId: string | null;
  merchants: Merchant[];
  onMerchantChange: (merchantId: string) => void;
}

const STARTER_PROMPTS = [
  'What was the revenue last week?',
  'Which products are best sellers?',
  'Compare this month to last month',
];

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 p-4">
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  );
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === 'user';

  // Render content with citation inline tags parsed out
  // The backend text may contain [src: shopify, fact_ids: ...] — strip them
  // since we render citations as chips from the citation event stream instead.
  const cleanContent = msg.content.replace(
    /\[src:[^\]]+\]/g, ''
  ).trim();

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-slide-up`}
    >
      <div
        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed
          ${isUser
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-surface-card border border-surface-border text-slate-100 rounded-bl-sm'
          }`}
      >
        {/* Message text */}
        <p className="whitespace-pre-wrap">{cleanContent || (msg.streaming ? '' : '…')}</p>

        {/* Streaming typing dots */}
        {msg.streaming && msg.content === '' && (
          <TypingIndicator />
        )}

        {/* Citation chips */}
        {msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/10">
            {msg.citations.map((c) => (
              <CitationChip key={c.id} citation={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatView({ merchantId, merchants, onMerchantChange }: Props) {
  const { messages, streaming, send, reset } = useSSEChat(merchantId);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming || !merchantId) return;
    setInput('');
    send(text);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-surface-border shrink-0">
        <div>
          <h2 className="text-base font-bold text-white">AI Analyst</h2>
          <p className="text-xs text-slate-400">Ask about revenue, products, orders</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            id="chat-merchant-select"
            value={merchantId ?? ''}
            onChange={(e) => onMerchantChange(e.target.value)}
            disabled={streaming || merchants.length === 0}
            className="input h-10 w-40 sm:w-52 py-2 text-xs"
          >
            {merchants.length === 0 && (
              <option value="">Loading merchants...</option>
            )}
            {merchants.map((merchant) => (
              <option key={merchant.id} value={merchant.id}>
                {merchant.name}
              </option>
            ))}
          </select>

          {messages.length > 0 && (
            <button
              id="chat-reset"
              onClick={reset}
              className="btn-ghost text-xs"
            >
              <ArrowPathIcon className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        id="chat-message-list"
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 flex flex-col gap-3 pb-4"
      >
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 py-12 animate-fade-in">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-brand-600/20 border border-brand-500/30
                              flex items-center justify-center mx-auto mb-4 text-2xl">
                🤖
              </div>
              <h3 className="font-semibold text-white mb-1">D2C AI Analyst</h3>
              <p className="text-sm text-slate-400 max-w-xs">
                Ask me anything about your Shopify store. I'll cite my sources.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => { setInput(p); }}
                  className="text-left px-4 py-3 rounded-xl bg-surface-card border border-surface-border
                             text-sm text-slate-300 hover:border-brand-500/50 hover:text-white
                             transition-all duration-150"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {/* Stream still active but last message exists */}
        {streaming && messages[messages.length - 1]?.content !== '' && (
          <div className="flex justify-start">
            <div className="bg-surface-card border border-surface-border rounded-2xl rounded-bl-sm px-4">
              <TypingIndicator />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-surface-border mb-16 sm:mb-0">
        {!merchantId && (
          <p className="text-center text-slate-500 text-sm mb-2">Loading merchant…</p>
        )}
        <div className="flex items-end gap-3">
          <textarea
            id="chat-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={!merchantId || streaming}
            placeholder="Ask about revenue, orders, products…"
            className="input flex-1 resize-none overflow-hidden leading-relaxed"
            style={{ minHeight: '44px', maxHeight: '120px' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <button
            id="chat-send"
            onClick={handleSend}
            disabled={!merchantId || streaming || !input.trim()}
            className="btn-primary h-11 px-4 shrink-0"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
