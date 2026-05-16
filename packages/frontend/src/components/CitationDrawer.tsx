import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Citation } from '../hooks/useSSEChat';

interface Props {
  citation: Citation;
  open: boolean;
  onClose: () => void;
}

export function CitationDrawer({ citation, open, onClose }: Props) {
  if (!open) return null;

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      id="citation-drawer-overlay"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />

      {/* Drawer panel */}
      <div
        className="relative z-10 w-full sm:max-w-lg mx-4 mb-4 sm:mb-0
                   card p-5 animate-slide-up max-h-[80vh] flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
        id="citation-drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white text-base">Source Citation</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {citation.factIds.length} fact record{citation.factIds.length !== 1 ? 's' : ''}
              {' '}from <span className="text-brand-300">{citation.source}</span>
            </p>
          </div>
          <button
            id="citation-drawer-close"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-border text-slate-400 hover:text-white transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Fact IDs */}
        <div className="flex-1 overflow-y-auto">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Fact IDs</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {citation.factIds.map((id) => (
              <span
                key={id}
                className="font-mono text-xs bg-surface-input border border-surface-border
                           px-2 py-1 rounded-lg text-slate-300"
              >
                {id}
              </span>
            ))}
          </div>

          {/* Raw payload */}
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Raw Payload</p>
          <pre
            id="citation-raw-payload"
            className="text-xs text-slate-300 bg-surface-input border border-surface-border
                       rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-all"
          >
            {JSON.stringify(citation.raw, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
