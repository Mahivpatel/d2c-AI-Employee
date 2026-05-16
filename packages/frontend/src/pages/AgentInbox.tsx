import { useState } from 'react';
import {
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
  InboxIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useAgents } from '../hooks/useAgents';
import type { DeadStockProposal, AgentRun } from '../api/client';

interface Props {
  merchantId: string | null;
}

const ACTION_LABELS: Record<DeadStockProposal['actionType'], string> = {
  apply_discount:   'Apply Discount',
  create_bundle:    'Create Bundle',
  flag_liquidation: 'Liquidate',
};

const ACTION_BADGE: Record<DeadStockProposal['actionType'], string> = {
  apply_discount:   'badge-yellow',
  create_bundle:    'badge-blue',
  flag_liquidation: 'badge-red',
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 shrink-0 w-8 text-right">{pct}%</span>
    </div>
  );
}

function ProposalCard({
  proposal,
  runId,
  onApprove,
  onDismiss,
}: {
  proposal:  DeadStockProposal;
  runId:     string;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);

  const handle = async (action: 'approve' | 'dismiss', fn: () => void) => {
    setBusy(action);
    try { await fn(); } finally { setBusy(null); }
  };

  return (
    <div className="card p-4 flex flex-col gap-3 animate-slide-up">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white text-sm font-mono">{proposal.target.sku}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {proposal.target.currentStock} units · ₹{proposal.target.capitalLockedInr.toLocaleString('en-IN')} locked
          </p>
        </div>
        <span className={ACTION_BADGE[proposal.actionType] + ' shrink-0'}>
          {ACTION_LABELS[proposal.actionType]}
        </span>
      </div>

      {/* Confidence */}
      <div>
        <p className="text-xs text-slate-500 mb-1">Confidence</p>
        <ConfidenceBar value={proposal.confidence} />
      </div>

      {/* Days since last sale */}
      <div className="flex gap-4 text-xs text-slate-400">
        <span>
          <span className="text-slate-300 font-medium">{proposal.target.daysSinceLastSale}</span> days since last sale
        </span>
        <span>
          Save ~₹<span className="text-emerald-400 font-medium">{proposal.estimatedSavingInr.toLocaleString('en-IN')}</span>
        </span>
      </div>

      {/* Reasoning */}
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-3 bg-surface-input rounded-xl px-3 py-2">
        {proposal.reasoning}
      </p>

      {/* Uncertainty note */}
      {proposal.uncertaintyNote && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
          <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">{proposal.uncertaintyNote}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          id={`approve-${runId}`}
          onClick={() => handle('approve', onApprove)}
          disabled={busy !== null}
          className="btn-success flex-1 justify-center"
        >
          {busy === 'approve'
            ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
            : <CheckIcon className="w-4 h-4" />}
          Approve
        </button>
        <button
          id={`dismiss-${runId}`}
          onClick={() => handle('dismiss', onDismiss)}
          disabled={busy !== null}
          className="btn-danger flex-1 justify-center"
        >
          {busy === 'dismiss'
            ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
            : <XMarkIcon className="w-4 h-4" />}
          Dismiss
        </button>
      </div>
    </div>
  );
}

function RunGroup({ run, approve, dismiss }: {
  run:     AgentRun;
  approve: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}) {
  const proposals = (Array.isArray(run.proposals) ? run.proposals : []) as DeadStockProposal[];

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            {run.agentName.replace(/_/g, ' ')}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            {new Date(run.runAt).toLocaleString('en-IN')}
          </p>
        </div>
        <span className="badge badge-slate">
          {proposals.length} proposal{proposals.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {proposals.map((p: DeadStockProposal, i: number) => (
          <ProposalCard
            key={i}
            proposal={p}
            runId={run.id}
            onApprove={() => approve(run.id)}
            onDismiss={() => dismiss(run.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default function AgentInbox({ merchantId }: Props) {
  const { runs, loading, error, approve, dismiss, refetch } = useAgents(merchantId);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 sm:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Agent Inbox</h2>
          <p className="text-sm text-slate-400 mt-0.5">Pending AI proposals for review</p>
        </div>
        <button
          id="inbox-refresh"
          onClick={refetch}
          disabled={loading}
          className="btn-ghost"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card p-4 border-rose-800/40 bg-rose-900/20 mb-4 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2].map((n) => (
            <div key={n} className="card p-4 h-44 animate-pulse bg-surface-border" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && runs.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-surface-card border border-surface-border
                          flex items-center justify-center">
            <InboxIcon className="w-7 h-7 text-slate-500" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-slate-300">All clear!</p>
            <p className="text-sm text-slate-500 mt-1">No pending proposals to review.</p>
          </div>
        </div>
      )}

      {/* Agent runs */}
      {!loading && runs.map((run) => (
        <RunGroup
          key={run.id}
          run={run}
          approve={approve}
          dismiss={dismiss}
        />
      ))}
    </div>
  );
}
