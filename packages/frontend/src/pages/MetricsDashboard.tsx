import { useState } from 'react';
import { ArrowPathIcon, SignalIcon } from '@heroicons/react/24/outline';
import { useMetrics } from '../hooks/useMetrics';
import { MetricCard } from '../components/MetricCard';
import { RevenueChart } from '../components/RevenueChart';

const PERIODS = [7, 14, 30] as const;

// Build a simple sparkline dataset for the chart
// Since the API returns totals (not daily), we create a single-point placeholder
// that still renders the chart with real data. A future enhancement can add
// daily breakdown to the metrics endpoint.
function buildChartData(
  revenueInr: number,
  roas: number | null,
  periodDays: number,
) {
  return [
    {
      label:      `${periodDays}d`,
      revenueInr: Math.round(revenueInr),
      roas:       roas,
    },
  ];
}

interface Props {
  merchantId: string | null;
}

export default function MetricsDashboard({ merchantId }: Props) {
  const [period, setPeriod] = useState<7 | 14 | 30>(7);
  const { data, loading, error, refetch } = useMetrics(merchantId, period);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  const chartData = data
    ? buildChartData(data.revenueInr, data.roas, data.periodDays)
    : [];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 sm:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Metrics</h2>
          <p className="text-sm text-slate-400 mt-0.5">Store performance overview</p>
        </div>
        <button
          id="metrics-refresh"
          onClick={refetch}
          disabled={loading}
          className="btn-ghost"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {PERIODS.map((p) => (
          <button
            key={p}
            id={`period-${p}d`}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150
              ${period === p
                ? 'bg-brand-600 text-white'
                : 'bg-surface-border text-slate-400 hover:text-white'}`}
          >
            {p}d
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="card p-4 border-rose-800/40 bg-rose-900/20 mb-6 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard
          label="Revenue"
          value={data ? fmt(data.revenueInr) : '—'}
          sub={data ? `${data.orderCount} orders` : undefined}
          color="default"
          loading={loading}
        />
        <MetricCard
          label="Ad Spend"
          value={data ? fmt(data.adSpendInr) : '—'}
          loading={loading}
        />
        <MetricCard
          label="ROAS"
          value={data?.roas != null ? `${data.roas}×` : '—'}
          color={data?.roas != null && data.roas >= 2 ? 'green' : 'yellow'}
          loading={loading}
        />
        <MetricCard
          label="RTO Rate"
          value={data ? `${data.rtoRatePct}%` : '—'}
          sub={data ? `${data.rtoCount}/${data.totalShipments} shipments` : undefined}
          color={data?.rtoRatePct != null && data.rtoRatePct > 15 ? 'red' : 'green'}
          trend={data?.rtoRatePct != null ? (data.rtoRatePct > 15 ? 'up' : 'down') : undefined}
          loading={loading}
        />
      </div>

      {/* Chart */}
      <div className="card p-5 mb-6">
        <RevenueChart data={chartData} loading={loading} />
      </div>

      {/* Last Synced */}
      {data && Object.keys(data.lastSynced).length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <SignalIcon className="w-4 h-4 text-slate-400" />
            <p className="text-sm font-semibold text-slate-300">Last Synced</p>
          </div>
          <div className="flex flex-col gap-2">
            {Object.entries(data.lastSynced).map(([connector, ts]) => (
              <div key={connector} className="flex items-center justify-between">
                <span className="badge badge-slate capitalize">{connector}</span>
                <span className="text-xs text-slate-400">
                  {ts ? new Date(ts).toLocaleString('en-IN') : 'Never'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
