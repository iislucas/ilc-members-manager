import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { MemberRowHeaderComponent } from './member-row-header';
import { initMember } from '../../../functions/src/data-model';

describe('MemberRowHeaderComponent', () => {
  let component: MemberRowHeaderComponent;
  let fixture: ComponentFixture<MemberRowHeaderComponent>;
  let componentRef: ComponentRef<MemberRowHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberRowHeaderComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(MemberRowHeaderComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('member', initMember());
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
