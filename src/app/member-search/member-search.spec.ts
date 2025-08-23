import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MemberSearchComponent } from './member-search';

describe('MemberSearch', () => {
  let component: MemberSearchComponent;
  let fixture: ComponentFixture<MemberSearchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberSearchComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MemberSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
