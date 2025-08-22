import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MemberSearch } from './member-search';

describe('MemberSearch', () => {
  let component: MemberSearch;
  let fixture: ComponentFixture<MemberSearch>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberSearch]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MemberSearch);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
