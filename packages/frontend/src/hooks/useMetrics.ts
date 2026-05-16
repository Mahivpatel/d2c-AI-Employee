import { useState, useEffect, useCallback } from 'react';
import { getMetrics, type MetricsResponse } from '../api/client';

export function useMetrics(merchantId: string | null, periodDays: number) {
  const [data, setData]       = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getMetrics(merchantId, periodDays);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [merchantId, periodDays]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
