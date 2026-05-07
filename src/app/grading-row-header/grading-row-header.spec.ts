import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { GradingRowHeaderComponent } from './grading-row-header';
import { initGrading } from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';

describe('GradingRowHeaderComponent', () => {
  let component: GradingRowHeaderComponent;
  let fixture: ComponentFixture<GradingRowHeaderComponent>;
  let componentRef: ComponentRef<GradingRowHeaderComponent>;
  let mockDataManagerService: any;

  beforeEach(async () => {
    mockDataManagerService = {
      members: { entries: () => [] },
      instructors: { entries: () => [] },
    };

    await TestBed.configureTestingModule({
      imports: [GradingRowHeaderComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService }
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(GradingRowHeaderComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('grading', initGrading());
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
