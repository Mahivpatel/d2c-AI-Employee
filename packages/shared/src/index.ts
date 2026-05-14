export interface NormalizedFact {
  source:           string;
  entityType:       string;
  occurredAt:       Date;
  amountInr:        number;
  rawId:            string;
  rawPayload:       Record<string, unknown>;
  dimensions:       Record<string, unknown>;
  currencyOriginal: string;
  fxRateUsed:       number;
}

export interface Citation {
  factIds:  string[];
  source:   string;
  pulledAt: string;
  rowCount: number;
}

export interface ChatResponse {
  response:      string;
  citations:     Citation[];
  toolCallsMade: number;
}
