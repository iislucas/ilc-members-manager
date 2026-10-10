import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { OrderList, SearchMode } from './order-list';
import { Order, OrderKind, OrderStatus } from '../../../functions/src/data-model/orders';

describe('OrderList', () => {
  let component: OrderList;
  let fixture: ComponentFixture<OrderList>;
  let mockDataManager: {
    orders: { loading: ReturnType<typeof signal>; entries: () => Order[] };
    getRecentOrders: ReturnType<typeof vi.fn>;
    searchOrders: ReturnType<typeof vi.fn>;
  };
  let urlOrderIdSignal: ReturnType<typeof signal>;
  let urlSearchModeSignal: ReturnType<typeof signal>;
  let urlSearchFieldSignal: ReturnType<typeof signal>;
  let urlQSignal: ReturnType<typeof signal>;
  let urlStartDateSignal: ReturnType<typeof signal>;
  let urlEndDateSignal: ReturnType<typeof signal>;
  let urlSortBySignal: ReturnType<typeof signal>;
  let urlSortDirSignal: ReturnType<typeof signal>;
  let urlStatusSignal: ReturnType<typeof signal>;
  let urlKindSignal: ReturnType<typeof signal>;
  let mockRoutingService: RoutingService<any>;

  const mockOrder: Order = {
    docId: 'DQJCygchO8qG71QaEDPK',
    ilcAppOrderKind: OrderKind.Stripe,
    ilcAppOrderStatus: OrderStatus.Processed,
    stripeOrderType: 'checkout',
    customerName: 'Roselli Lorenzini Pietro Nicolaus',
    customerEmail: 'pietro.n.roselli.lorenzini@gmail.com',
    amountTotal: 4999,
    currency: 'usd',
    created: '2026-10-06T14:04:37.000Z',
    lastUpdated: '2026-10-06T14:04:37.000Z',
    lineItems: [
      {
        description: 'Offering Hands (Full Series)',
        quantity: 1,
        amountTotal: 4999,
        currency: 'usd',
        productId: 'prod_123',
        priceId: 'price_123',
      },
    ],
  };

  async function createComponent(options?: {
    orderId?: string;
    searchMode?: string;
    searchField?: string;
    q?: string;
  }) {
    urlOrderIdSignal = signal(options?.orderId || '');
    urlSearchModeSignal = signal(options?.searchMode || '');
    urlSearchFieldSignal = signal(options?.searchField || '');
    urlQSignal = signal(options?.q || '');
    urlStartDateSignal = signal('');
    urlEndDateSignal = signal('');
    urlSortBySignal = signal('');
    urlSortDirSignal = signal('');
    urlStatusSignal = signal('');
    urlKindSignal = signal('');

    mockDataManager = {
      orders: {
        loading: signal(false),
        entries: () => [],
      },
      getRecentOrders: vi.fn().mockResolvedValue([mockOrder]),
      searchOrders: vi.fn().mockResolvedValue([mockOrder]),
    };

    mockRoutingService = {
      navigateTo: vi.fn(),
      signals: {
        manageOrders: {
          urlParams: {
            orderId: urlOrderIdSignal,
            searchMode: urlSearchModeSignal,
            searchField: urlSearchFieldSignal,
            q: urlQSignal,
            startDate: urlStartDateSignal,
            endDate: urlEndDateSignal,
            sortBy: urlSortBySignal,
            sortDir: urlSortDirSignal,
            status: urlStatusSignal,
            kind: urlKindSignal,
          },
        },
      },
    } as never as RoutingService<any>;

    await TestBed.configureTestingModule({
      imports: [OrderList],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should create and load recent orders by default when no search params provided', async () => {
    await createComponent();
    expect(component).toBeTruthy();
    expect(component.searchMode()).toBe(SearchMode.Recent);
    expect(mockDataManager.getRecentOrders).toHaveBeenCalled();
  });

  it('should initialize with orderId URL param, switch to Term mode, and perform search', async () => {
    await createComponent({ orderId: 'DQJCygchO8qG71QaEDPK' });
    expect(component.searchMode()).toBe(SearchMode.Term);
    expect(component.searchField()).toBe('orderId');
    expect(component.searchTerm()).toBe('DQJCygchO8qG71QaEDPK');
    expect(mockDataManager.searchOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'term',
        searchField: 'orderId',
        term: 'DQJCygchO8qG71QaEDPK',
      }),
    );
  });

  it('should initialize with q and searchField=orderId without explicit searchMode, switch to Term mode, and perform search', async () => {
    await createComponent({
      q: 'DQJCygchO8qG71QaEDPK',
      searchField: 'orderId',
    });
    expect(component.searchMode()).toBe(SearchMode.Term);
    expect(component.searchField()).toBe('orderId');
    expect(component.searchTerm()).toBe('DQJCygchO8qG71QaEDPK');
    expect(mockDataManager.searchOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'term',
        searchField: 'orderId',
        term: 'DQJCygchO8qG71QaEDPK',
      }),
    );
  });

  it('should perform search when searchField is manually set to orderId', async () => {
    await createComponent();
    component.searchMode.set(SearchMode.Term);
    component.searchField.set('orderId');
    component.searchTerm.set('DQJCygchO8qG71QaEDPK');

    await component.search();

    expect(mockDataManager.searchOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'term',
        searchField: 'orderId',
        term: 'DQJCygchO8qG71QaEDPK',
      }),
    );
    expect(component.rawOrders()).toEqual([mockOrder]);
  });
});
