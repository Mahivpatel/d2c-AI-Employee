import { useState, useEffect, useCallback } from 'react';
import { getAgents, approveAgent, dismissAgent, type AgentRun } from '../api/client';

export function useAgents(merchantId: string | null) {
  const [runs, setRuns]       = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAgents(merchantId, 'pending_review');
      setRuns(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => { fetch(); }, [fetch]);

  const approve = async (id: string) => {
    // Optimistic removal
    setRuns((prev) => prev.filter((r) => r.id !== id));
    try {
      await approveAgent(id);
    } catch (e) {
      // Re-fetch if optimistic update failed
      fetch();
      throw e;
    }
  };

  const dismiss = async (id: string) => {
    setRuns((prev) => prev.filter((r) => r.id !== id));
    try {
      await dismissAgent(id);
    } catch (e) {
      fetch();
      throw e;
    }
  };

  return { runs, loading, error, approve, dismiss, refetch: fetch };
}
