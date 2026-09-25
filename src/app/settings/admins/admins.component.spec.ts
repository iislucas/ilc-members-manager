import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AdminsSettingsComponent } from './admins.component';
import { DataManagerService } from '../../data-manager.service';
import { FirebaseStateService } from '../../firebase-state.service';
import * as firestore from 'firebase/firestore';

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<any>('firebase/firestore');
  return {
    ...actual,
    getFirestore: vi.fn().mockReturnValue({}),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    onSnapshot: vi.fn(),
  };
});

describe('AdminsSettingsComponent', () => {
  let component: AdminsSettingsComponent;
  let fixture: ComponentFixture<AdminsSettingsComponent>;
  let mockDataManager: any;
  let mockFirebaseState: any;
  let mockOnSnapshotUnsubscribe: any;

  beforeEach(async () => {
    mockOnSnapshotUnsubscribe = vi.fn();
    (firestore.onSnapshot as any).mockImplementation((q: any, next: any) => {
      // Simulate snapshot callback
      next({
        docs: [
          {
            id: 'admin1@example.com',
            data: () => ({ isAdmin: true, memberDocIds: ['m1'] }),
          },
          {
            id: 'admin2@example.com',
            data: () => ({ isAdmin: true, memberDocIds: [] }),
          },
        ],
      });
      return mockOnSnapshotUnsubscribe;
    });

    mockDataManager = {
      members: {
        get: vi.fn().mockImplementation((id: string) => {
          if (id === 'm1') return { name: 'Lucas Dixon', memberId: 'US402' };
          return null;
        }),
      },
      setAdminPrivilege: vi.fn().mockResolvedValue({ success: true, email: 'new@example.com', isAdmin: true }),
    };

    mockFirebaseState = {
      app: {},
      user: signal({
        firebaseUser: { email: 'admin1@example.com' },
        isAdmin: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [AdminsSettingsComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminsSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load administrators from onSnapshot', () => {
    expect(component).toBeTruthy();
    expect(component.admins().length).toBe(2);
    expect(component.admins()[0].email).toBe('admin1@example.com');
    expect(component.admins()[0].memberNames).toEqual(['Lucas Dixon (US402)']);
    expect(component.admins()[1].email).toBe('admin2@example.com');
    expect(component.admins()[1].memberNames).toEqual([]);
  });

  it('should identify the current user email', () => {
    expect(component.currentUserEmail()).toBe('admin1@example.com');
  });

  it('should add an admin when a valid email is submitted', async () => {
    component.newAdminEmail.set('newadmin@iliqchuan.com');
    await component.addAdmin();

    expect(mockDataManager.setAdminPrivilege).toHaveBeenCalledWith(
      'newadmin@iliqchuan.com',
      true,
    );
    expect(component.statusMessage()).toContain('newadmin@iliqchuan.com');
    expect(component.newAdminEmail()).toBe('');
  });

  it('should reject invalid email formats', async () => {
    component.newAdminEmail.set('not-an-email');
    await component.addAdmin();

    expect(mockDataManager.setAdminPrivilege).not.toHaveBeenCalled();
    expect(component.errorMessage()).toBe('Please enter a valid email address.');
  });

  it('should reject already existing admins', async () => {
    component.newAdminEmail.set('admin1@example.com');
    await component.addAdmin();

    expect(mockDataManager.setAdminPrivilege).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('already an administrator');
  });

  it('should prevent self-revocation', () => {
    component.promptRevoke('admin1@example.com');

    expect(component.emailToRevoke()).toBeNull();
    expect(component.errorMessage()).toContain('cannot revoke your own administrator privileges');
  });

  it('should open confirmation dialog for other admins and revoke on confirm', async () => {
    component.promptRevoke('admin2@example.com');
    expect(component.emailToRevoke()).toBe('admin2@example.com');

    await component.confirmRevoke();

    expect(mockDataManager.setAdminPrivilege).toHaveBeenCalledWith('admin2@example.com', false);
    expect(component.emailToRevoke()).toBeNull();
    expect(component.statusMessage()).toContain('Successfully revoked administrator privileges');
  });
});
