import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { MemberImportExportComponent } from './member-import-export';

describe('MemberImportExportComponent', () => {
  let component: MemberImportExportComponent;
  let fixture: ComponentFixture<MemberImportExportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberImportExportComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(MemberImportExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
