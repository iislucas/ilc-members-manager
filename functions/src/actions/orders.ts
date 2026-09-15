/* orders.ts
 *
 * Order inspection, notes management, member/school linkage, and
 * reprocessing actions for Squarespace, Stripe, and Sheets-imported orders.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreCollection } from '../data-model/collections';
import {
  Order,
  OrderKind,
  OrderStatus,
  SquareSpaceOrder,
  firestoreDocToOrder,
} from '../data-model/orders';
import { clearOrderProcessingState } from '../squarespace-orders';
import { ActionContext, ActionResult } from './types';

/** Options for listing/querying orders. */
export interface OrderListOptions {
  orderKind?: OrderKind;
  status?: OrderStatus;
  customerEmail?: string;
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
  limitCount?: number;
}

/**
 * Retrieves an order document by docId.
 */
export async function getOrder(
  ctx: ActionContext,
  orderDocId: string,
): Promise<Order | null> {
  if (!orderDocId) return null;
  const docRef = ctx.db.collection(FirestoreCollection.Orders).doc(orderDocId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return firestoreDocToOrder(snap);
}

/**
 * Finds an order by its customer-facing order number or reference.
 */
export async function getOrderByNumber(
  ctx: ActionContext,
  orderNumber: string,
): Promise<Order | null> {
  if (!orderNumber) return null;
  const cleanNum = orderNumber.trim();

  // 1. Search orderNumber (Squarespace)
  const sqSnap = await ctx.db
    .collection(FirestoreCollection.Orders)
    .where('orderNumber', '==', cleanNum)
    .limit(1)
    .get();

  if (!sqSnap.empty) {
    return firestoreDocToOrder(sqSnap.docs[0]);
  }

  // 2. Search referenceNumber (Sheets import)
  const sheetsSnap = await ctx.db
    .collection(FirestoreCollection.Orders)
    .where('referenceNumber', '==', cleanNum)
    .limit(1)
    .get();

  if (!sheetsSnap.empty) {
    return firestoreDocToOrder(sheetsSnap.docs[0]);
  }

  // 3. Fall back to docId
  return getOrder(ctx, cleanNum);
}

/**
 * Lists orders matching query filters.
 */
export async function listOrders(
  ctx: ActionContext,
  options?: OrderListOptions,
): Promise<Order[]> {
  let q = ctx.db.collection(FirestoreCollection.Orders).limit(options?.limitCount || 100);

  if (options?.orderKind) {
    q = q.where('ilcAppOrderKind', '==', options.orderKind);
  }
  if (options?.status) {
    q = q.where('ilcAppOrderStatus', '==', options.status);
  }

  const snap = await q.get();
  let orders = snap.docs.map(firestoreDocToOrder);

  if (options?.customerEmail) {
    const cleanEmail = options.customerEmail.toLowerCase().trim();
    orders = orders.filter((o) => {
      const email = 'customerEmail' in o ? (o as SquareSpaceOrder).customerEmail : ('email' in o ? (o as { email?: string }).email : '');
      return (email || '').toLowerCase() === cleanEmail;
    });
  }

  if (options?.searchTerm) {
    const term = options.searchTerm.toLowerCase().trim();
    orders = orders.filter((o) => {
      const num = 'orderNumber' in o ? (o as SquareSpaceOrder).orderNumber : ('referenceNumber' in o ? (o as { referenceNumber?: string }).referenceNumber : '');
      const email = 'customerEmail' in o ? (o as SquareSpaceOrder).customerEmail : ('email' in o ? (o as { email?: string }).email : '');
      return (num && num.toLowerCase().includes(term)) || (email && email.toLowerCase().includes(term)) || o.docId.includes(term);
    });
  }

  orders.sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));
  return orders;
}

/**
 * Updates free-form admin notes on an order.
 */
export async function updateOrderNotes(
  ctx: ActionContext,
  orderDocId: string,
  notes: string,
): Promise<ActionResult<void>> {
  const existing = await getOrder(ctx, orderDocId);
  if (!existing) {
    return { success: false, error: `Order "${orderDocId}" not found.` };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Updated notes on order ${orderDocId}`);
    return { success: true, dryRun: true };
  }

  const orderRef = ctx.db.collection(FirestoreCollection.Orders).doc(orderDocId);
  await orderRef.update({
    ilcAppNotes: notes,
    lastUpdated: FieldValue.serverTimestamp(),
  });

  ctx.logger?.(`Updated notes on order ${orderDocId}`);
  return { success: true };
}

/**
 * Manually links or overrides the inferred member ID for an order line item.
 */
export async function linkOrderToMember(
  ctx: ActionContext,
  orderDocId: string,
  memberId: string,
  lineItemIndex = 0,
): Promise<ActionResult<void>> {
  const existing = await getOrder(ctx, orderDocId);
  if (!existing) {
    return { success: false, error: `Order "${orderDocId}" not found.` };
  }

  if (existing.ilcAppOrderKind !== OrderKind.Squarespace) {
    return { success: false, error: 'Member linking is only supported for Squarespace orders.' };
  }

  const sqOrder = existing as SquareSpaceOrder;
  if (!sqOrder.lineItems || sqOrder.lineItems.length <= lineItemIndex) {
    return { success: false, error: `Line item index ${lineItemIndex} not found on order.` };
  }

  const updatedLineItems = [...sqOrder.lineItems];
  updatedLineItems[lineItemIndex] = {
    ...updatedLineItems[lineItemIndex],
    ilcAppMemberIdInferred: memberId.trim().toUpperCase(),
  };

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Linked order ${orderDocId} line item ${lineItemIndex} to member ${memberId}`);
    return { success: true, dryRun: true };
  }

  const orderRef = ctx.db.collection(FirestoreCollection.Orders).doc(orderDocId);
  await orderRef.update({
    lineItems: updatedLineItems,
    lastUpdated: FieldValue.serverTimestamp(),
  });

  ctx.logger?.(`Linked order ${orderDocId} line item ${lineItemIndex} to member ${memberId}`);
  return { success: true };
}

/**
 * Manually links or overrides the inferred school ID for an order line item.
 */
export async function linkOrderToSchool(
  ctx: ActionContext,
  orderDocId: string,
  schoolId: string,
  lineItemIndex = 0,
): Promise<ActionResult<void>> {
  const existing = await getOrder(ctx, orderDocId);
  if (!existing) {
    return { success: false, error: `Order "${orderDocId}" not found.` };
  }

  if (existing.ilcAppOrderKind !== OrderKind.Squarespace) {
    return { success: false, error: 'School linking is only supported for Squarespace orders.' };
  }

  const sqOrder = existing as SquareSpaceOrder;
  if (!sqOrder.lineItems || sqOrder.lineItems.length <= lineItemIndex) {
    return { success: false, error: `Line item index ${lineItemIndex} not found on order.` };
  }

  const updatedLineItems = [...sqOrder.lineItems];
  updatedLineItems[lineItemIndex] = {
    ...updatedLineItems[lineItemIndex],
    ilcAppSchoolIdInferred: schoolId.trim().toUpperCase(),
  };

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Linked order ${orderDocId} line item ${lineItemIndex} to school ${schoolId}`);
    return { success: true, dryRun: true };
  }

  const orderRef = ctx.db.collection(FirestoreCollection.Orders).doc(orderDocId);
  await orderRef.update({
    lineItems: updatedLineItems,
    lastUpdated: FieldValue.serverTimestamp(),
  });

  ctx.logger?.(`Linked order ${orderDocId} line item ${lineItemIndex} to school ${schoolId}`);
  return { success: true };
}

/**
 * Clears an order's downstream processing state so that backend order processing
 * triggers or reprocessing scripts can re-evaluate and fulfill it cleanly.
 */
export async function reprocessOrder(
  ctx: ActionContext,
  orderDocId: string,
): Promise<ActionResult<{ reprocessed: boolean }>> {
  const existing = await getOrder(ctx, orderDocId);
  if (!existing) {
    return { success: false, error: `Order "${orderDocId}" not found.` };
  }

  if (existing.ilcAppOrderKind !== OrderKind.Squarespace) {
    return { success: false, error: 'Reprocessing is only supported for Squarespace orders.' };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Would reset processing state on order ${orderDocId}`);
    return { success: true, data: { reprocessed: true }, dryRun: true };
  }

  const orderRef = ctx.db.collection(FirestoreCollection.Orders).doc(orderDocId);
  const sqOrder = { ...(existing as SquareSpaceOrder) };
  clearOrderProcessingState(sqOrder);
  const payload: Record<string, unknown> = {
    ...sqOrder,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete payload['docId'];
  await orderRef.set(payload);
  ctx.logger?.(`Cleared processing state on order ${orderDocId} for reprocessing`);

  return { success: true, data: { reprocessed: true } };
}
