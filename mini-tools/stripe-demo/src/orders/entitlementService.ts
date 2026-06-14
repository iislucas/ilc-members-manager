import type { Order } from "../stripe/types.js";

export type EntitlementSnapshot = {
  externalOrderId: string;
  active: boolean;
  activeUntil: Date | null;
  updatedAt: Date;
};

const entitlements = new Map<string, EntitlementSnapshot>();

export function grantOrExtendEntitlement(order: Order): EntitlementSnapshot {
  const snapshot: EntitlementSnapshot = {
    externalOrderId: order.externalOrderId,
    active: true,
    activeUntil: order.currentPeriodEnd,
    updatedAt: new Date(),
  };

  entitlements.set(order.externalOrderId, snapshot);
  return snapshot;
}

export function revokeEntitlement(externalOrderId: string): EntitlementSnapshot {
  const snapshot: EntitlementSnapshot = {
    externalOrderId,
    active: false,
    activeUntil: null,
    updatedAt: new Date(),
  };

  entitlements.set(externalOrderId, snapshot);
  return snapshot;
}

export function getEntitlement(externalOrderId: string): EntitlementSnapshot | null {
  return entitlements.get(externalOrderId) ?? null;
}
