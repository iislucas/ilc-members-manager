import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MemberListComponent } from './member-list';
import { FirebaseStateService } from '../firebase-state.service';
import { SearchableSet } from '../searchable-set';
import { Member, initMember } from '../../../functions/src/data-model';
import { signal, Component, Input } from '@angular/core';
import { MemberEditComponent } from '../member-edit/member-edit';

@Component({
  selector: 'app-member-edit',
  standalone: true,
  template: '',
})
class MockMemberEditComponent {
  @Input() member: any;
  @Input() allMembers: any;
  @Input() collapse: any;
  @Input() canDelete: any;
}

describe('MemberListComponent', () => {
  let component: MemberListComponent;
  let fixture: ComponentFixture<MemberListComponent>;
  let mockFirebaseStateService: any;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({ isAdmin: true, schoolsManaged: [] }),
    };

    await TestBed.configureTestingModule({
      imports: [MemberListComponent, MockMemberEditComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
      ],
    })
      .overrideComponent(MemberListComponent, {
        remove: { imports: [MemberEditComponent] },
        add: { imports: [MockMemberEditComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MemberListComponent);
    component = fixture.componentInstance;

    // Create a set of 60 members
    const members: Member[] = [];
    for (let i = 0; i < 60; i++) {
      const m = initMember();
      m.id = `member-${i}`;
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
