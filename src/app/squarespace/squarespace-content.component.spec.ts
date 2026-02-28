import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SquarespaceContentComponent, ProcessedBlogEntry } from './squarespace-content.component';
import { RoutingService } from '../routing.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { SquarespaceService } from './squarespace.service';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { Views } from '../app.config';

describe('SquarespaceContentComponent', () => {
    let component: SquarespaceContentComponent;
    let fixture: ComponentFixture<SquarespaceContentComponent>;
    let routingServiceMock: Partial<RoutingService<any>>;

    beforeEach(async () => {
        routingServiceMock = {
            navigateTo: vi.fn(),
            matchedPatternId: signal(null),
            signals: {
                [Views.ActiveMembers]: {},
                [Views.ActiveMembersCategory]: { pathVars: { category: signal('') } },
                [Views.ActiveInstructors]: {},
                [Views.ActiveInstructorsCategory]: { pathVars: { category: signal('') } }
            }
        } as unknown as RoutingService<any>;

        const squarespaceSvcMock = {
            getSquarespaceContent: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [SquarespaceContentComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: RoutingService, useValue: routingServiceMock },
                { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
                { provide: SquarespaceService, useValue: squarespaceSvcMock },
            ]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(SquarespaceContentComponent);
        component = fixture.componentInstance;
    });

    it('should navigate to members-area/post/id if path includes member', () => {
        fixture.componentRef.setInput('path', '/membersareablog');
        fixture.detectChanges();

        const entry = { urlId: 'my-post' } as ProcessedBlogEntry;
        component.navigateToArticle(entry);
        expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('members-area/post/my-post');
    });

    it('should navigate to instructors-area/post/id if path includes instructor', () => {
        fixture.componentRef.setInput('path', '/instructorsblog');
        fixture.detectChanges();

        const entry = { urlId: 'my-instr-post' } as ProcessedBlogEntry;
        component.navigateToArticle(entry);
        expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('instructors-area/post/my-instr-post');
    });
});
