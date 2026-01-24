import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { IdAssignmentComponent } from './id-assignment';

describe('IdAssignmentComponent', () => {
  let component: IdAssignmentComponent;
  let fixture: ComponentFixture<IdAssignmentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IdAssignmentComponent],
      providers: [provideZonelessChangeDetection()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(IdAssignmentComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('initAssignment', {
      kind: 'AssignNewAutoId',
      curId: 'A1',
    });
    fixture.componentRef.setInput('canEdit', true);
    fixture.componentRef.setInput('expectedNextId', 'A2');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
