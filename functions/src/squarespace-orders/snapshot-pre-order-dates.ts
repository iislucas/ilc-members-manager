import { SquareSpaceLineItem } from '../data-model';

// Snapshot the entity's current renewal and expiry dates onto the line item
// before processing changes them. Write-once: if the fields are already set
// (e.g. from a previous processing run), this is a no-op.
export function snapshotPreOrderDates(
  lineItem: SquareSpaceLineItem,
  currentRenewalDate: string,
  currentExpiryDate: string
) {
  if (lineItem.ilcAppPreOrderExpiryDate !== undefined) return;
  lineItem.ilcAppPreOrderRenewalDate = currentRenewalDate;
  lineItem.ilcAppPreOrderExpiryDate = currentExpiryDate;
}
