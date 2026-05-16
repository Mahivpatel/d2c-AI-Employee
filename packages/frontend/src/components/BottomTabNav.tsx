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

// Desktop sidebar — hidden on mobile
export function DesktopSidebar({ merchant }: { merchant?: { name: string } }) {
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
        {merchant && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{merchant.name}</p>
        )}
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
