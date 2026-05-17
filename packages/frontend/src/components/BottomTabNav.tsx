import { NavLink, useLocation } from 'react-router-dom';
import {
  ChartBarIcon,
  ChatBubbleBottomCenterTextIcon,
  InboxArrowDownIcon,
} from '@heroicons/react/24/outline';
import {
  ChartBarIcon as ChartBarSolid,
  ChatBubbleBottomCenterTextIcon as ChatSolid,
  InboxArrowDownIcon as InboxSolid,
} from '@heroicons/react/24/solid';
import type { Merchant } from '../api/client';

const tabs = [
  { to: '/metrics', label: 'Metrics', Icon: ChartBarIcon,                      ActiveIcon: ChartBarSolid },
  { to: '/chat',    label: 'Chat',    Icon: ChatBubbleBottomCenterTextIcon,     ActiveIcon: ChatSolid     },
  { to: '/inbox',   label: 'Inbox',   Icon: InboxArrowDownIcon,                 ActiveIcon: InboxSolid    },
];

export function BottomTabNav() {
  const { pathname } = useLocation();

  return (
    /* Visible only on mobile — sm:hidden hides it on larger screens */
    <nav
      id="bottom-tab-nav"
      className="sm:hidden fixed bottom-0 left-0 right-0 z-50
                 bg-surface-card/95 backdrop-blur-md
                 border-t border-surface-border
                 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ to, label, Icon, ActiveIcon }) => {
        const active = pathname.startsWith(to);
        const Ico = active ? ActiveIcon : Icon;
        return (
          <NavLink
            key={to}
            to={to}
            id={`tab-${label.toLowerCase()}`}
            className={() =>
              `tab-item ${active ? 'active' : ''}`
            }
          >
            <Ico className="w-6 h-6" />
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

interface MerchantSelectorProps {
  merchants: Merchant[];
  merchantId: string | null;
  onMerchantChange: (merchantId: string) => void;
  compact?: boolean;
}

export function MerchantSelector({
  merchants,
  merchantId,
  onMerchantChange,
  compact = false,
}: MerchantSelectorProps) {
  return (
    <label className="block">
      <span className="sr-only">Select merchant</span>
      <select
        id={compact ? 'mobile-merchant-select' : 'sidebar-merchant-select'}
        value={merchantId ?? ''}
        onChange={(e) => onMerchantChange(e.target.value)}
        disabled={merchants.length === 0}
        className={
          compact
            ? 'input h-9 w-full py-1.5 text-xs'
            : 'input h-10 w-full py-2 text-xs'
        }
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
    </label>
  );
}

// Desktop sidebar - hidden on mobile
export function DesktopSidebar({
  merchants,
  merchantId,
  onMerchantChange,
}: {
  merchants: Merchant[];
  merchantId: string | null;
  onMerchantChange: (merchantId: string) => void;
}) {
  const { pathname } = useLocation();

  return (
    <aside
      id="desktop-sidebar"
      className="hidden sm:flex flex-col w-56 shrink-0
                 bg-surface-card border-r border-surface-border
                 min-h-screen p-4 gap-1"
    >
      {/* Logo */}
      <div className="mb-6 px-2">
        <h1 className="text-lg font-bold text-white tracking-tight">D2C AI</h1>
        <div className="mt-3">
          <MerchantSelector
            merchants={merchants}
            merchantId={merchantId}
            onMerchantChange={onMerchantChange}
          />
        </div>
      </div>

      {tabs.map(({ to, label, Icon, ActiveIcon }) => {
        const active = pathname.startsWith(to);
        const Ico = active ? ActiveIcon : Icon;
        return (
          <NavLink
            key={to}
            to={to}
            id={`sidebar-${label.toLowerCase()}`}
            className={() =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
               ${active
                ? 'bg-brand-600/20 text-brand-300'
                : 'text-slate-400 hover:text-white hover:bg-surface-border'}`
            }
          >
            <Ico className="w-5 h-5 shrink-0" />
            {label}
          </NavLink>
        );
      })}
    </aside>
  );
}
