import { useState } from 'react';
import type { Citation } from '../hooks/useSSEChat';
import { CitationDrawer } from './CitationDrawer';

interface Props {
  citation: Citation;
}

export function CitationChip({ citation }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        id={`citation-chip-${citation.id}`}
        onClick={() => setOpen(true)}
        className="citation-chip"
        title={`${citation.factIds.length} fact${citation.factIds.length !== 1 ? 's' : ''} from ${citation.source}`}
      >
        📎 {citation.source}·{citation.factIds.length}
      </button>

      <CitationDrawer
        citation={citation}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
