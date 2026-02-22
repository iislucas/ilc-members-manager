import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Backups } from './backups';
import { DataManagerService } from '../../data-manager.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../../firebase-state.service';
import { vi } from 'vitest';

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn().mockReturnValue({}),
  httpsCallable: vi.fn(),
}));

describe('Backups', () => {
  let component: Backups;
  let fixture: ComponentFixture<Backups>;

  let firebaseMock: any;

  beforeEach(async () => {
    firebaseMock = createFirebaseStateServiceMock();
    firebaseMock.app = { name: '[DEFAULT]' };

    const mockDataManager = {
      listBackups: vi.fn().mockResolvedValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [Backups],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: FirebaseStateService, useValue: firebaseMock }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Backups);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
