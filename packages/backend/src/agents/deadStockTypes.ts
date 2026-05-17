// ── Dead Stock Agent — shared types ───────────────────────────────────────────

export interface SkuSalesSummary {
  sku: string;
  productTitle?: string | null;
  productType?: string | null;
  vendor?: string | null;
  tags?: string | null;
  price?: number;
  costSource?: string | null;
  currentStock: number;
  costPerItem: number;
  capitalLockedInr: number;
  unitsSoldInPeriod: number;
  revenueInPeriod?: number;
  lastSaleAt: string | null;
  daysSinceLastSale: number;
}

export interface MerchantContext {
  category: string;
  warehouseCostPerUnitPerDay: number;
  currentMonth: string;
  totalOrdersLast30Days: number;
  avgOrderValue: number;
}

export type DeadStockActionType =
  | 'apply_discount'
  | 'create_bundle'
  | 'flag_liquidation';

export interface DeadStockTarget {
  sku: string;
  currentStock: number;
  capitalLockedInr: number;
  daysSinceLastSale: number;
}

export interface DeadStockProposal {
  actionType: DeadStockActionType;
  target: DeadStockTarget;
  estimatedSavingInr: number;
  reasoning: string;
  confidence: number;
  uncertaintyNote?: string;
}

export interface DeadStockAgentInput {
  merchantId: string;
  lookbackDays: number;
  minCapitalLockedInr: number;
}
