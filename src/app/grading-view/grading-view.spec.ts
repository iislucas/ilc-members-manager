/* grading-view.spec.ts
 *
 * Tests for GradingViewComponent. Mocks child components and services
 * to verify the component loads and wires up correctly.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, Component, Input, Output, EventEmitter } from '@angular/core';
import { GradingViewComponent } from './grading-view';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { initGrading, Grading } from '../../../functions/src/data-model';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';
import { GradingProgressComponent } from '../grading-progress/grading-progress';

@Component({
  selector: 'app-grading-edit',
  standalone: true,
  template: '',
})
class MockGradingEditComponent {
  @Input() grading: unknown;
  @Input() collapsable: unknown;
}

@Component({
  selector: 'app-grading-row-header',
  standalone: true,
  template: '',
})
class MockGradingRowHeaderComponent {
  @Input() grading: unknown;
}

@Component({
  selector: 'app-grading-progress',
  standalone: true,
  template: '',
})
class MockGradingProgressComponent {
  @Input() grading: unknown;
  @Output() gradingUpdated = new EventEmitter<Partial<Grading>>();
}

describe('GradingViewComponent', () => {
  let component: GradingViewComponent;
  let fixture: ComponentFixture<GradingViewComponent>;
  let componentRef: ComponentRef<GradingViewComponent>;
  let mockDataManagerService: Partial<DataManagerService>;
  let mockRoutingService: unknown;

  beforeEach(async () => {
    mockDataManagerService = {
      gradings: {
        get: () => ({ ...initGrading(), docId: '123', studentMemberId: 'student-1' }),
        loading: () => false,
      } as never,
      myGradings: {
        get: () => undefined,
        loading: () => false,
      } as never,
      myGradingsAssessed: {
        get: () => undefined,
        loading: () => false,
      } as never,
      members: { entries: () => [] } as never,
      updateGrading: () => Promise.resolve(),
      getGradingById: () => Promise.resolve({ ...initGrading(), docId: '123', studentMemberId: 'student-1' }),
      loadingState: (() => 'Loaded') as never,
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
      imports: [
        GradingViewComponent,
        MockGradingEditComponent,
        MockGradingRowHeaderComponent,
        MockGradingProgressComponent,
      ],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
      ]
    })
      .overrideComponent(GradingViewComponent, {
        remove: { imports: [GradingEditComponent, GradingRowHeaderComponent, GradingProgressComponent] },
        add: { imports: [MockGradingEditComponent, MockGradingRowHeaderComponent, MockGradingProgressComponent] },
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
