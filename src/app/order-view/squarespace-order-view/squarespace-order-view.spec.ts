import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { SquarespaceOrderView } from './squarespace-order-view';
import { DataManagerService } from '../../data-manager.service';
import { SquareSpaceOrder, Member } from '../../../../functions/src/data-model';

function makeOrder(lineItems: SquareSpaceOrder['lineItems']): SquareSpaceOrder {
  return {
    docId: 'test-order-doc',
    lastUpdated: '2026-03-01T00:00:00Z',
    ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
    id: 'abc',
    orderNumber: '1',
    createdOn: '2026-03-01T00:00:00Z',
    modifiedOn: '2026-03-01T00:00:00Z',
    customerEmail: 'test@example.com',
    fulfillmentStatus: 'PENDING',
    lineItems,
  };
}

describe('SquarespaceOrderView', () => {
  let component: SquarespaceOrderView;
  let fixture: ComponentFixture<SquarespaceOrderView>;
  let membersMapSignal: ReturnType<typeof signal<Map<string, Member>>>;
  let schoolsMapSignal: ReturnType<typeof signal<Map<string, unknown>>>;

  beforeEach(async () => {
    membersMapSignal = signal(new Map<string, Member>());
    schoolsMapSignal = signal(new Map<string, unknown>());

    const dataManagerServiceMock = {
      members: { entries: signal([]), entriesMap: membersMapSignal },
      schools: { entriesMap: schoolsMapSignal },
      lookupMembersByEmail: () => [],
      setOrderLineItemInferredMemberId: vi.fn().mockResolvedValue(undefined),
      setOrderLineItemCountryOverride: vi.fn().mockResolvedValue(undefined),
      countries: { entries: signal([]) },
    };

    await TestBed.configureTestingModule({
      imports: [SquarespaceOrderView],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: dataManagerServiceMock },
      ],
    }).compileComponents();
  });

  function createComponent(order: SquareSpaceOrder) {
    fixture = TestBed.createComponent(SquarespaceOrderView);
    fixture.componentRef.setInput('order', order);
    component = fixture.componentInstance;
  }

  it('should create', async () => {
    createComponent(makeOrder([]));
    await fixture.whenStable();
    expect(component).toBeTruthy();
  });

  it('should produce a warning preview when member ID is not found in database', async () => {
    const order = makeOrder([{
      id: 'line-1',
      sku: 'MEM-YEAR-IND',
      productId: 'prod-1',
      productName: 'Membership : Annual (Individual)',
      quantity: '1',
      unitPricePaid: { value: '50.00' },
      customizations: [
        { label: 'MemberID', value: 'GHOST-999' },
        { label: 'Name', value: 'Ghost Member' },
        { label: 'Email', value: 'ghost@example.com' },
      ],
    }]);

    // members map is empty — member GHOST-999 does not exist.
    membersMapSignal.set(new Map());

    createComponent(order);
    await fixture.whenStable();

    const previews = component.lineItemPreviews();
    const preview = previews.get('line-1');

    expect(preview).not.toBeNull();
    expect(preview!.entityId).toBe('GHOST-999');
    expect(preview!.entityFound).toBe(false);
    expect(preview!.entityName).toBe('');
    expect(preview!.entityKind).toBe('member');
    // Should still have preview dates computed (from order date).
    expect(preview!.isRecorded).toBe(false);
  });

  it('should show member name when member ID is found in database', async () => {
    const order = makeOrder([{
      id: 'line-2',
      sku: 'MEM-YEAR-IND',
      productId: 'prod-1',
      productName: 'Membership : Annual (Individual)',
      quantity: '1',
      unitPricePaid: { value: '50.00' },
      customizations: [
        { label: 'MemberID', value: 'US123' },
        { label: 'Name', value: 'Test Person' },
        { label: 'Email', value: 'test@example.com' },
      ],
    }]);

    // Set up the members map with the member.
    membersMapSignal.set(new Map([
      ['US123', { memberId: 'US123', name: 'Jane Doe' } as Member],
    ]));

    createComponent(order);
    await fixture.whenStable();

    const previews = component.lineItemPreviews();
    const preview = previews.get('line-2');

    expect(preview).not.toBeNull();
    expect(preview!.entityId).toBe('US123');
    expect(preview!.entityFound).toBe(true);
    expect(preview!.entityName).toBe('Jane Doe');
    expect(preview!.entityKind).toBe('member');
    expect(preview!.entityProfileLink).toBe('#/members/US123');
    // Preview dates based on order date 2026-03-01, 12 months.
    expect(preview!.renewalDate).toBe('2026-03-01');
    expect(preview!.expiryDate).toBe('2027-03-01');
    expect(preview!.isRecorded).toBe(false);
  });

  it('should return null preview for non-expiry SKUs', async () => {
    const order = makeOrder([{
      id: 'line-3',
      sku: 'SOME-OTHER-SKU',
      productId: 'prod-2',
      productName: 'Some Other Product',
      quantity: '1',
      unitPricePaid: { value: '10.00' },
      customizations: [],
    }]);

    createComponent(order);
    await fixture.whenStable();

    const previews = component.lineItemPreviews();
    const preview = previews.get('line-3');

    expect(preview).toBeNull();
  });

  it('should prefer ilcAppMemberIdInferred over customization member ID', async () => {
    const order = makeOrder([{
      id: 'line-4',
      sku: 'MEM-YEAR-IND',
      productId: 'prod-1',
      productName: 'Membership : Annual (Individual)',
      quantity: '1',
      unitPricePaid: { value: '50.00' },
      ilcAppMemberIdInferred: 'US456',
      customizations: [
        { label: 'MemberID', value: 'US123' },
      ],
    }]);

    membersMapSignal.set(new Map([
      ['US456', { memberId: 'US456', name: 'Preferred Member' } as Member],
      ['US123', { memberId: 'US123', name: 'Form Member' } as Member],
    ]));

    createComponent(order);
    await fixture.whenStable();

    const preview = component.lineItemPreviews().get('line-4');

    expect(preview).not.toBeNull();
    // Should use the inferred member ID, not the customization one.
    expect(preview!.entityId).toBe('US456');
    expect(preview!.entityName).toBe('Preferred Member');
    expect(preview!.entityFound).toBe(true);
  });

  it('should call data service and emit orderUpdated when saving inferred member ID', async () => {
    const lineItem = {
      id: 'line-5',
      sku: 'MEM-YEAR-IND',
      productId: 'prod-1',
      productName: 'Membership : Annual (Individual)',
      quantity: '1' as const,
      unitPricePaid: { value: '50.00' },
      customizations: [
        { label: 'MemberID', value: 'OLD-ID' },
      ],
    };
    const order = makeOrder([lineItem]);

    createComponent(order);
    await fixture.whenStable();

    // Simulate user typing a new member ID.
    component.setInferredMemberIdInput('line-5', 'NEW-ID');

    // Verify unsaved change is detected.
    expect(component.hasUnsavedChange(lineItem)).toBe(true);
    expect(component.getInferredMemberId(lineItem)).toBe('NEW-ID');

    // Spy on orderUpdated output.
    const orderUpdatedSpy = vi.fn();
    component.orderUpdated.subscribe(orderUpdatedSpy);

    // Trigger save.
    const mockSetInferred = TestBed.inject(DataManagerService).setOrderLineItemInferredMemberId as ReturnType<typeof vi.fn>;
    await component.saveInferredMemberId(lineItem);

    // Verify the data service was called with correct arguments.
    expect(mockSetInferred).toHaveBeenCalledWith('test-order-doc', 'line-5', 'NEW-ID');

    // Verify orderUpdated was emitted (so the parent can refetch).
    expect(orderUpdatedSpy).toHaveBeenCalled();

    // After save, the input state should be cleared.
    expect(component.hasUnsavedChange(lineItem)).toBe(false);
  });

  it('should extend from member current expiry when it is later than order date', async () => {
    const order = makeOrder([{
      id: 'line-6',
      sku: 'MEM-YEAR-IND',
      productId: 'prod-1',
      productName: 'Membership : Annual (Individual)',
      quantity: '1',
      unitPricePaid: { value: '50.00' },
      customizations: [
        { label: 'MemberID', value: 'US789' },
      ],
    }]);

    // Member's current membership expires 2026-06-15, which is AFTER the
    // order date (2026-03-01). The preview should extend from the existing
    // expiry, not the order date.
    membersMapSignal.set(new Map([
      ['US789', { memberId: 'US789', name: 'Early Renewer', currentMembershipExpires: '2026-06-15' } as Member],
    ]));

    createComponent(order);
    await fixture.whenStable();

    const preview = component.lineItemPreviews().get('line-6');
    expect(preview).not.toBeNull();
    // renewalDate = max(currentExpiry, orderDate) = 2026-06-15
    expect(preview!.renewalDate).toBe('2026-06-15');
    // expiryDate = renewalDate + 12 months = 2027-06-15
    expect(preview!.expiryDate).toBe('2027-06-15');
  });

  it('should call data service when saving country override', async () => {
    const lineItem = {
      id: 'line-c1',
      sku: 'MEM-YEAR-IND',
      productId: 'prod-1',
      productName: 'Membership : Annual (Individual)',
      quantity: '1' as const,
      unitPricePaid: { value: '50.00' },
      customizations: [],
    };
    const order = makeOrder([lineItem]);

    createComponent(order);
    await fixture.whenStable();

    component.setCountryOverrideInput('line-c1', 'Slovenia');

    expect(component.hasCountryUnsavedChange(lineItem)).toBe(true);
    expect(component.getCountryOverride(lineItem)).toBe('Slovenia');

    const orderUpdatedSpy = vi.fn();
    component.orderUpdated.subscribe(orderUpdatedSpy);

    const mockSetOverride = TestBed.inject(DataManagerService).setOrderLineItemCountryOverride as ReturnType<typeof vi.fn>;
    await component.saveCountryOverride(lineItem);

    expect(mockSetOverride).toHaveBeenCalledWith('test-order-doc', 'line-c1', 'Slovenia');
    expect(orderUpdatedSpy).toHaveBeenCalled();
    expect(component.hasCountryUnsavedChange(lineItem)).toBe(false);
  });
});
