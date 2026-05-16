// ── API client ────────────────────────────────────────────────────────────────
// All fetch calls proxy through Vite dev server (/api → http://localhost:3000/api)

const BASE = '/api';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Merchants ─────────────────────────────────────────────────────────────────

export interface Merchant {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

export const getMerchants = () => apiFetch<Merchant[]>('/merchants');

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface MetricsResponse {
  periodDays:    number;
  revenueInr:    number;
  orderCount:    number;
  adSpendInr:    number;
  roas:          number | null;
  rtoRatePct:    number;
  rtoCount:      number;
  totalShipments:number;
  lastSynced:    Record<string, string | null>;
}

export const getMetrics = (merchantId: string, periodDays: number) =>
  apiFetch<MetricsResponse>(`/metrics?merchantId=${merchantId}&periodDays=${periodDays}`);

// ── Agents ────────────────────────────────────────────────────────────────────

export interface DeadStockProposal {
  actionType:          'apply_discount' | 'create_bundle' | 'flag_liquidation';
  target:              { sku: string; currentStock: number; capitalLockedInr: number; daysSinceLastSale: number };
  estimatedSavingInr:  number;
  reasoning:           string;
  confidence:          number;
  uncertaintyNote?:    string;
}

export interface AgentRun {
  id:              string;
  merchantId:      string;
  agentName:       string;
  runAt:           string;
  status:          'pending_review' | 'approved' | 'dismissed' | 'executed';
  proposals:       DeadStockProposal[];
  confidenceScore: number;
  reviewedAt:      string | null;
}

export const getAgents = (merchantId: string, status = 'pending_review') =>
  apiFetch<AgentRun[]>(`/agents?merchantId=${merchantId}&status=${status}`);

export const approveAgent = (id: string) =>
  apiFetch<{ status: string }>(`/agents/${id}/approve`, { method: 'POST' });

export const dismissAgent = (id: string) =>
  apiFetch<{ status: string }>(`/agents/${id}/dismiss`, { method: 'POST' });

// ── Chat (POST) ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const postChat = (merchantId: string, message: string, history: ChatMessage[]) =>
  apiFetch<{ reply: string }>('/chat', {
    method: 'POST',
    body: JSON.stringify({ merchantId, message, history }),
  });

// ── SSE event types ───────────────────────────────────────────────────────────

export type SSEEvent =
  | { type: 'token';    content: string }
  | { type: 'citation'; factIds: string[]; source: string; raw: unknown }
  | { type: 'done' };

export function openChatStream(
  merchantId: string,
  message: string,
  history: ChatMessage[],
  onEvent: (e: SSEEvent) => void,
  onError?: (err: Event) => void,
): EventSource {
  const params = new URLSearchParams({
    merchantId,
    message,
    history: JSON.stringify(history),
  });
  const es = new EventSource(`${BASE}/chat/stream?${params.toString()}`);

  es.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data) as SSEEvent;
      onEvent(payload);
      if (payload.type === 'done') es.close();
    } catch {
      /* ignore parse errors */
    }
  };

  if (onError) es.onerror = onError;

  return es;
}
