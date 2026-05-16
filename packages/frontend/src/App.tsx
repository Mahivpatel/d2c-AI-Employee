import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { BottomTabNav, DesktopSidebar } from './components/BottomTabNav';
import MetricsDashboard from './pages/MetricsDashboard';
import ChatView         from './pages/ChatView';
import AgentInbox       from './pages/AgentInbox';
import { getMerchants, type Merchant } from './api/client';

export default function App() {
  const [merchants, setMerchants]   = useState<Merchant[]>([]);
  const [merchant, setMerchant]     = useState<Merchant | null>(null);
  const [merchantErr, setMerchantErr] = useState<string | null>(null);

  // Auto-select first active merchant on load
  useEffect(() => {
    getMerchants()
      .then((list) => {
        setMerchants(list);
        if (list.length > 0) setMerchant(list[0]);
        else setMerchantErr('No active merchants found. Run the seed script.');
      })
      .catch((e) => setMerchantErr(e.message));
  }, []);

  const mid = merchant?.id ?? null;
  const handleMerchantChange = (merchantId: string) => {
    const next = merchants.find((m) => m.id === merchantId) ?? null;
    setMerchant(next);
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* Desktop sidebar */}
      <DesktopSidebar merchant={merchant ?? undefined} />

      {/* Main content area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Merchant error banner */}
        {merchantErr && (
          <div className="px-4 py-2 bg-rose-900/40 border-b border-rose-800/40 text-rose-300 text-xs text-center">
            {merchantErr}
          </div>
        )}

        {/* Merchant name banner on mobile */}
        {merchant && (
          <div className="sm:hidden flex items-center px-4 py-2.5 border-b border-surface-border bg-surface-card/80 shrink-0">
            <span className="text-xs text-slate-400">
              Store: <span className="text-slate-200 font-medium">{merchant.name}</span>
            </span>
          </div>
        )}

        <Routes>
          <Route path="/"        element={<Navigate to="/metrics" replace />} />
          <Route path="/metrics" element={<MetricsDashboard merchantId={mid} />} />
          <Route
            path="/chat"
            element={(
              <ChatView
                merchantId={mid}
                merchants={merchants}
                onMerchantChange={handleMerchantChange}
              />
            )}
          />
          <Route path="/inbox"   element={<AgentInbox merchantId={mid} />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <BottomTabNav />
    </div>
  );
}
