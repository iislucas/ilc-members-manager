import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SquarespaceContentComponent, ProcessedBlogEntry } from './squarespace-content.component';
import { RoutingService } from '../routing.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { vi } from 'vitest';
import { Views, FIREBASE_APP } from '../app.config';
import { initializeApp } from 'firebase/app';
import { CachedBlogPost } from '../../../functions/src/data-model/content-cache';

interface InternalComponentState {
    subscribed: WritableSignal<boolean>;
    rawPosts: WritableSignal<CachedBlogPost[]>;
}

describe('SquarespaceContentComponent', () => {
    let component: SquarespaceContentComponent;
    let fixture: ComponentFixture<SquarespaceContentComponent>;
    let routingServiceMock: Partial<RoutingService<never>>;
    let firebaseServiceMock: FirebaseStateService;

    beforeEach(async () => {
        routingServiceMock = {
            navigateTo: vi.fn(),
            navigateToParts: vi.fn(),
            matchedPatternId: signal(null),
            signals: {
                [Views.MembersArea]: { urlParams: { category: signal('') } },
                [Views.MembersAreaCategory]: { pathVars: { category: signal('') } },
                [Views.InstructorsArea]: { urlParams: { category: signal('') } },
                [Views.InstructorsAreaCategory]: { pathVars: { category: signal('') } },
                [Views.Articles]: { urlParams: { category: signal('') } },
                [Views.ArticlesCategory]: { pathVars: { category: signal('') } },
            }
        } as unknown as RoutingService<never>;

        firebaseServiceMock = createFirebaseStateServiceMock();

        await TestBed.configureTestingModule({
            imports: [SquarespaceContentComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: RoutingService, useValue: routingServiceMock },
                { provide: FirebaseStateService, useValue: firebaseServiceMock },
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

        const internal = component as unknown as InternalComponentState;
        internal.subscribed.set(true);
        internal.rawPosts.set([
            { id: '1', title: 'Post 1', categories: ['Learn'], body: '', excerpt: '', urlId: 'p1' } as CachedBlogPost,
            { id: '2', title: 'Post 2', categories: ['Announcements'], body: '', excerpt: '', urlId: 'p2' } as CachedBlogPost,
            { id: '3', title: 'Post 3', categories: ['Videos'], body: '', excerpt: '', urlId: 'p3' } as CachedBlogPost,
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

    it('hides drafts in All and category sections, and shows drafts only in Drafts section', () => {
        vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
        fixture.componentRef.setInput('path', 'articles-post');
        fixture.detectChanges();

        const internal = component as unknown as InternalComponentState;
        internal.subscribed.set(true);
        internal.rawPosts.set([
            { id: '1', title: 'Published 1', categories: ['Philosophy'], isDraft: false, body: '', excerpt: '', urlId: 'pub-1' } as CachedBlogPost,
            { id: '2', title: 'Draft 1', categories: ['Philosophy'], isDraft: true, body: '', excerpt: '', urlId: 'draft-1' } as CachedBlogPost,
            { id: '3', title: 'Published 2', categories: ['Curriculum'], isDraft: false, body: '', excerpt: '', urlId: 'pub-2' } as CachedBlogPost,
            { id: '4', title: 'Draft Only Category Post', categories: ['DraftOnlyCategory'], isDraft: true, body: '', excerpt: '', urlId: 'draft-2' } as CachedBlogPost,
        ]);

        // In 'All' category: only non-drafts are shown
        component.selectedCategory.set('All');
        const allEntries = component.filteredEntries();
        expect(allEntries.map(e => e.id)).toEqual(['1', '3']);

        // In 'Philosophy' category: only non-draft Philosophy posts are shown
        component.selectedCategory.set('Philosophy');
        const philoEntries = component.filteredEntries();
        expect(philoEntries.map(e => e.id)).toEqual(['1']);

        // In 'Drafts' category: only drafts are shown
        component.selectedCategory.set('Drafts');
        const draftEntries = component.filteredEntries();
        expect(draftEntries.map(e => e.id)).toEqual(['2', '4']);

        // Categories should have 'All', non-draft categories, and 'Drafts' (no 'DraftOnlyCategory')
        expect(component.categories()).toEqual(['All', 'Curriculum', 'Philosophy', 'Drafts']);
    });

    it('hides the "Instructors" pill on the articles pages', () => {
        vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
        fixture.componentRef.setInput('path', 'articles-post');
        fixture.detectChanges();

        const internal = component as unknown as InternalComponentState;
        internal.subscribed.set(true);
        internal.rawPosts.set([
            { id: '1', title: 'Published Article', categories: ['Philosophy'], isDraft: false, body: '', excerpt: '', urlId: 'p1' } as CachedBlogPost,
            { id: '2', title: 'Published Instructors Post', categories: ['Instructors'], isDraft: false, body: '', excerpt: '', urlId: 'p2' } as CachedBlogPost,
            { id: '3', title: 'Draft Instructors Post', categories: ['Instructors'], isDraft: true, body: '', excerpt: '', urlId: 'p3' } as CachedBlogPost,
        ]);

        const categories = component.categories();
        // Should not contain 'Instructors' or 'Instructor'
        expect(categories).toContain('All');
        expect(categories).toContain('Philosophy');
        expect(categories).toContain('Drafts');
        expect(categories).not.toContain('Instructors');
        expect(categories).not.toContain('Instructor');
    });

    it('redirects to All if category is Instructors on articles-post', () => {
        fixture.componentRef.setInput('path', 'articles-post');
        fixture.detectChanges();

        const matchedPatternIdSignal = routingServiceMock.matchedPatternId as WritableSignal<string | null>;
        matchedPatternIdSignal.set(Views.ArticlesCategory);

        const categorySignal = routingServiceMock.signals![Views.ArticlesCategory].pathVars.category as WritableSignal<string>;
        categorySignal.set('Instructors');

        TestBed.flushEffects();

        expect(component.selectedCategory()).toBe('All');
        expect(routingServiceMock.navigateToParts).toHaveBeenCalledWith(['articles', 'category', 'All']);
    });

    it('ensures other users (non-admins) cannot see drafts or the Drafts tab', () => {
        vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(false);
        fixture.componentRef.setInput('path', 'articles-post');
        fixture.detectChanges();

        const internal = component as unknown as InternalComponentState;
        internal.subscribed.set(true);
        internal.rawPosts.set([
            { id: '1', title: 'Published Article', categories: ['Philosophy'], isDraft: false, status: 'published', body: '', excerpt: '', urlId: 'p1' } as CachedBlogPost,
            { id: '2', title: 'Draft with isDraft=true', categories: ['Philosophy'], isDraft: true, body: '', excerpt: '', urlId: 'p2' } as CachedBlogPost,
            { id: '3', title: 'Draft with status=draft', categories: ['Curriculum'], isDraft: false, status: 'draft', body: '', excerpt: '', urlId: 'p3' } as CachedBlogPost,
        ]);

        // blogEntries() should ONLY contain published posts
        const entries = component.blogEntries();
        expect(entries.map(e => e.id)).toEqual(['1']);

        // categories() should not contain 'Drafts'
        expect(component.categories()).toEqual(['All', 'Philosophy']);

        // filteredEntries() in 'All' should only contain published
        component.selectedCategory.set('All');
        expect(component.filteredEntries().map(e => e.id)).toEqual(['1']);

        // Even if selectedCategory is somehow 'Drafts', filteredEntries() returns empty for non-admins
        component.selectedCategory.set('Drafts');
        expect(component.filteredEntries()).toEqual([]);
    });

    it('redirects non-admins to All if category is Drafts in URL', () => {
        vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(false);
        fixture.componentRef.setInput('path', 'articles-post');
        fixture.detectChanges();

        const matchedPatternIdSignal = routingServiceMock.matchedPatternId as WritableSignal<string | null>;
        matchedPatternIdSignal.set(Views.ArticlesCategory);

        const categorySignal = routingServiceMock.signals![Views.ArticlesCategory].pathVars.category as WritableSignal<string>;
        categorySignal.set('Drafts');

        TestBed.flushEffects();

        expect(component.selectedCategory()).toBe('All');
        expect(routingServiceMock.navigateToParts).toHaveBeenCalledWith(['articles', 'category', 'All']);
    });
});
