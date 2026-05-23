import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MemberSelectorComponent } from './member-selector';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { vi } from 'vitest';

describe('MemberSelectorComponent', () => {
  let component: MemberSelectorComponent;
  let fixture: ComponentFixture<MemberSelectorComponent>;
  let mockDataManagerService: DataManagerService;

  beforeEach(async () => {
    mockDataManagerService = {
      members: new SearchableSet(['name'], 'memberId'),
      getMember: vi.fn(),
      getMemberByMemberId: vi.fn(),
    } as never as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [MemberSelectorComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemberSelectorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('value', 'IT41');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
