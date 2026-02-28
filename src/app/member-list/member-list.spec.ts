import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MemberListComponent } from './member-list';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';
import { SearchableSet } from '../searchable-set';
import { Member, initMember } from '../../../functions/src/data-model';
import { signal, Component, Input } from '@angular/core';
import { MemberDetailsComponent } from '../member-details/member-details';
import { MemberRowHeaderComponent } from '../member-row-header/member-row-header';

@Component({
  selector: 'app-member-details',
  standalone: true,
  template: '',
})
class MockMemberDetailsComponent {
  @Input() member: any;
  @Input() allMembers: any;
  @Input() collapsable: any;
  @Input() canDelete: any;
}

@Component({
  selector: 'app-member-row-header',
  standalone: true,
  template: '',
})
class MockMemberRowHeaderComponent {
  @Input() member: any;
  @Input() isDirty: any;
}

describe('MemberListComponent', () => {
  let component: MemberListComponent;
  let fixture: ComponentFixture<MemberListComponent>;
  let mockFirebaseStateService: FirebaseStateService;
  let mockRoutingService: RoutingService<AppPathPatterns>;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({ isAdmin: true, schoolsManaged: [] }),
    } as never as FirebaseStateService;
    mockRoutingService = {
      matchedPatternId: signal('members'),
      signals: { members: { urlParams: { q: signal(''), memberId: signal('') } } }
    } as never as RoutingService<AppPathPatterns>;

    await TestBed.configureTestingModule({
      imports: [MemberListComponent, MockMemberDetailsComponent, MockMemberRowHeaderComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: RoutingService, useValue: mockRoutingService }
      ],
    }).overrideComponent(MemberListComponent, {
      remove: { imports: [MemberDetailsComponent, MemberRowHeaderComponent] },
      add: { imports: [MockMemberDetailsComponent, MockMemberRowHeaderComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MemberListComponent);
    component = fixture.componentInstance;

    // Create a set of 60 members
    const members: Member[] = [];
    for (let i = 0; i < 60; i++) {
      const m = initMember();
      m.docId = `member-${i}`;
      m.memberId = `member-${i}`;
      m.name = `Member ${i}`;
      members.push(m);
    }
    const memberSet = new SearchableSet<'memberId', Member>(
      ['name'],
      'memberId',
      members,
    );

    // Set the input signal
    fixture.componentRef.setInput('memberSet', memberSet);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should limit members to 50 initially', () => {
    expect(component.limit()).toBe(50);
    expect(component.members().length).toBe(50);
    expect(component.totalMembers()).toBe(60);
  });

  it('should show all members when showAll is called', () => {
    component.showAll();
    fixture.detectChanges();
    expect(component.limit()).toBe(Infinity);
    expect(component.members().length).toBe(60);
  });

  it('should reset limit to 50 when search is performed', () => {
    component.showAll();
    fixture.detectChanges();
    expect(component.limit()).toBe(Infinity);

    const input = document.createElement('input');
    input.value = 'Member';
    const event = { target: input } as any;
    component.onSearch(event);

    expect(component.limit()).toBe(50);
  });
});
