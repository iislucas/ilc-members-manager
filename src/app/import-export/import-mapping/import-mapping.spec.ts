import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImportMappingComponent } from './import-mapping';

describe('ImportMapping', () => {
  let component: ImportMappingComponent;
  let fixture: ComponentFixture<ImportMappingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportMappingComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(ImportMappingComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('headers', []);
    fixture.componentRef.setInput('fieldsToMap', []);
    fixture.componentRef.setInput('parsedData', []);
    fixture.componentRef.setInput('mapping', {});
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
