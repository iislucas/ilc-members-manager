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
                [Views.MembersArea]: { urlParams: { category: signal('') } },
                [Views.MembersAreaCategory]: { pathVars: { category: signal('') } },
                [Views.InstructorsArea]: { urlParams: { category: signal('') } },
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

    it('maps Learn to Article for tags and pluralizes tab labels', () => {
        fixture.componentRef.setInput('path', 'instructors-post');
        fixture.detectChanges();

        (component as any).subscribed.set(true);
        (component as any).rawPosts.set([
            { id: '1', title: 'Post 1', categories: ['Learn'], body: '', excerpt: '', urlId: 'p1' },
            { id: '2', title: 'Post 2', categories: ['Announcements'], body: '', excerpt: '', urlId: 'p2' },
            { id: '3', title: 'Post 3', categories: ['Videos'], body: '', excerpt: '', urlId: 'p3' },
        ]);

        const entries = component.blogEntries();
        expect(entries[0].categories).toEqual(['Article']);
        expect(entries[1].categories).toEqual(['Announcement']);
        expect(entries[2].categories).toEqual(['Videos']);

        expect(component.categories()).toEqual(['All', 'Announcement', 'Article', 'Videos']);
        expect(component.tabLabel('Article')).toBe('Articles');
        expect(component.tabLabel('Announcement')).toBe('Announcements');
        expect(component.tabLabel('Videos')).toBe('Videos');
    });
});
