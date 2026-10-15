import type { PortalAuthAdapter } from '../auth/browser-adapter';

export const OBSERVATION_MS: number;
export type OperationCard = {
  stable_id: string; title: string; lifecycle: string; owner_role: string;
  created_at: string; updated_at: string; dependency_ids: string[];
  blocker_codes: string[]; evidence_handles: string[]; supersedes_id: string | null;
};
export type OperationsView = {
  health: 'healthy' | 'stale' | 'reconciling' | 'incompatible' | 'unavailable';
  authoritative: boolean; actions_enabled: false; projection_revision: string | null;
  source_watermark: { producer_identity: string; source_revision: string }[];
  cards: OperationCard[];
};
export type ReaderState = {
  status: string; session: 'unverified' | 'open' | 'closed'; signedIn: boolean;
  pending: boolean; uncertain: boolean; view: OperationsView | null; observedAt: number | null;
};
export type OperationsReader = {
  start(): Promise<void>; subscribe(listener: () => void): () => void;
  getSnapshot(): ReaderState; open(): Promise<void>; close(): Promise<void>;
  refresh(): Promise<void>; setVisible(visible: boolean): void; checkDisplay(): void; dispose(): void;
};
export function createOperationsReader(options: {
  adapter: PortalAuthAdapter; origin: string; localTest?: boolean;
}): OperationsReader;
