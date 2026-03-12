import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SquarespaceContentComponent, ProcessedBlogEntry } from './squarespace-content.component';
import { RoutingService } from '../routing.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { Views, FIREBASE_APP } from '../app.config';
import { initializeApp } from 'firebase/app';

describe('SquarespaceContentComponent', () => {
    let component: SquarespaceContentComponent;
    let fixture: ComponentFixture<SquarespaceContentComponent>;
    let routingServiceMock: Partial<RoutingService<never>>;

    beforeEach(async () => {
        routingServiceMock = {
            navigateTo: vi.fn(),
            matchedPatternId: signal(null),
            signals: {
                [Views.MembersArea]: {},
                [Views.MembersAreaCategory]: { pathVars: { category: signal('') } },
                [Views.InstructorsArea]: {},
                [Views.InstructorsAreaCategory]: { pathVars: { category: signal('') } }
            }
        } as unknown as RoutingService<never>;

        await TestBed.configureTestingModule({
            imports: [SquarespaceContentComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: RoutingService, useValue: routingServiceMock },
                { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
                {
                    provide: FIREBASE_APP,
                    useValue: initializeApp(
                        {
                            apiKey: 'fake',
                            authDomain: 'fake',
                            projectId: 'fake',
                            storageBucket: 'fake',
                            messagingSenderId: 'fake',
                            appId: 'fake',
                        },
                        `test-sqsp-${Math.random()}`,
                    ),
                },
            ]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(SquarespaceContentComponent);
        component = fixture.componentInstance;
    });

    it('should navigate to members-area/post/id for members-post collection', () => {
        fixture.componentRef.setInput('path', 'members-post');
        fixture.detectChanges();

        const entry = { urlId: 'my-post' } as ProcessedBlogEntry;
        component.navigateToArticle(entry);
        expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('members-area/post/my-post');
    });

    it('should navigate to instructors-area/post/id for instructors-post collection', () => {
        fixture.componentRef.setInput('path', 'instructors-post');
        fixture.detectChanges();

        const entry = { urlId: 'my-instr-post' } as ProcessedBlogEntry;
        component.navigateToArticle(entry);
        expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('instructors-area/post/my-instr-post');
    });
});
