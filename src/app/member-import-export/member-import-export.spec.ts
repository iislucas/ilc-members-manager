import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MemberImportExport } from './member-import-export';

describe('MemberImportExport', () => {
  let component: MemberImportExport;
  let fixture: ComponentFixture<MemberImportExport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberImportExport]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MemberImportExport);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
