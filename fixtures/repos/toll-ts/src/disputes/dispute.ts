export type DisputeStatus = 'open' | 'upheld' | 'rejected';

/** A customer or operator challenge against a session's charge. */
export interface Dispute {
  id: string;
  sessionId: string;
  reason: 'wrong-plate' | 'double-charge' | 'wrong-class' | 'other';
  status: DisputeStatus;
  openedAt: number;
  resolvedAt?: number;
}
