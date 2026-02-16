import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImportMapping } from './import-mapping';

describe('ImportMapping', () => {
  let component: ImportMapping;
  let fixture: ComponentFixture<ImportMapping>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportMapping]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ImportMapping);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
