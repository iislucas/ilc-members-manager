import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, Component, Input } from '@angular/core';
import { GradingViewComponent } from './grading-view';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { initGrading } from '../../../functions/src/data-model';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';

@Component({
  selector: 'app-grading-edit',
  standalone: true,
  template: '',
})
class MockGradingEditComponent {
  @Input() grading: any;
  @Input() collapsable: any;
}

@Component({
  selector: 'app-grading-row-header',
  standalone: true,
  template: '',
})
class MockGradingRowHeaderComponent {
  @Input() grading: any;
}

describe('GradingViewComponent', () => {
  let component: GradingViewComponent;
  let fixture: ComponentFixture<GradingViewComponent>;
  let componentRef: ComponentRef<GradingViewComponent>;
  let mockDataManagerService: any;
  let mockRoutingService: any;

  beforeEach(async () => {
    mockDataManagerService = {
      gradings: {
        get: () => ({ ...initGrading(), docId: '123', studentMemberId: 'student-1' }),
        loading: () => false,
      },
      members: { entries: () => [] },
    };

    mockRoutingService = {
      hrefForView: () => '#/gradings',
      signals: {
        gradingView: {
          pathVars: {
            gradingId: () => '123'
          }
        }
      }
    };

    await TestBed.configureTestingModule({
      imports: [GradingViewComponent, MockGradingEditComponent, MockGradingRowHeaderComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
      ]
    })
      .overrideComponent(GradingViewComponent, {
        remove: { imports: [GradingEditComponent, GradingRowHeaderComponent] },
        add: { imports: [MockGradingEditComponent, MockGradingRowHeaderComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GradingViewComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('gradingId', '123');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
