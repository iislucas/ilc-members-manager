import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SquarespaceArticleComponent } from './squarespace-article.component';
import { RoutingService } from '../routing.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { Views, FIREBASE_APP } from '../app.config';
import { initializeApp } from 'firebase/app';
import { CachedBlogPost } from '../../../functions/src/data-model/content-cache';

interface InternalComponentState {
  subscribed: WritableSignal<boolean>;
  postsLoading: WritableSignal<boolean>;
  rawPosts: WritableSignal<CachedBlogPost[]>;
}

describe('SquarespaceArticleComponent', () => {
  let component: SquarespaceArticleComponent;
  let fixture: ComponentFixture<SquarespaceArticleComponent>;
  let routingServiceMock: Partial<RoutingService<never>>;
  let firebaseServiceMock: FirebaseStateService;

  beforeEach(async () => {
    routingServiceMock = {
      navigateTo: vi.fn(),
      hrefForView: vi.fn((view: string, vars?: Record<string, string>) => `/${view}/${vars?.['blogPostPath'] || ''}`),
      signals: {},
    } as unknown as RoutingService<never>;

    firebaseServiceMock = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [SquarespaceArticleComponent],
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
            `test-sqsp-art-${Math.random()}`,
          ),
        },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(SquarespaceArticleComponent);
    component = fixture.componentInstance;
  });

  it('computes correct editHref for different collections', () => {
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'article-slug');
    fixture.detectChanges();

    expect(component.editHref()).toBe('/articlesPostEdit/article-slug');

    fixture.componentRef.setInput('collection', 'members-post');
    fixture.detectChanges();
    expect(component.editHref()).toBe('/membersAreaPostEdit/article-slug');

    fixture.componentRef.setInput('collection', 'instructors-post');
    fixture.detectChanges();
    expect(component.editHref()).toBe('/instructorsAreaPostEdit/article-slug');
  });

  it('shows Edit button for admins', () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'test-slug');
    fixture.detectChanges();

    const internal = component as unknown as InternalComponentState;
    internal.subscribed.set(true);
    internal.postsLoading.set(false);
    internal.rawPosts.set([
      {
        id: '1',
        title: 'Test Title',
        urlId: 'test-slug',
        body: '<p>Body content</p>',
        excerpt: 'Excerpt',
        isDraft: false,
        categories: ['News'],
      } as CachedBlogPost,
    ]);
    fixture.detectChanges();

    const editBtn = fixture.nativeElement.querySelector('.edit-post-btn');
    expect(editBtn).not.toBeNull();
    expect(editBtn.getAttribute('href')).toBe('/articlesPostEdit/test-slug');
  });

  it('hides Edit button for non-admins', () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(false);
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'test-slug');
    fixture.detectChanges();

    const internal = component as unknown as InternalComponentState;
    internal.subscribed.set(true);
    internal.postsLoading.set(false);
    internal.rawPosts.set([
      {
        id: '1',
        title: 'Test Title',
        urlId: 'test-slug',
        body: '<p>Body content</p>',
        excerpt: 'Excerpt',
        isDraft: false,
        categories: ['News'],
      } as CachedBlogPost,
    ]);
    fixture.detectChanges();

    const editBtn = fixture.nativeElement.querySelector('.edit-post-btn');
    expect(editBtn).toBeNull();
  });

  it('hides draft articles from non-admins', () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(false);
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'draft-slug');
    fixture.detectChanges();

    const internal = component as unknown as InternalComponentState;
    internal.subscribed.set(true);
    internal.postsLoading.set(false);
    internal.rawPosts.set([
      {
        id: '1',
        title: 'Draft Post',
        urlId: 'draft-slug',
        body: '<p>Secret</p>',
        excerpt: '',
        isDraft: true,
      } as CachedBlogPost,
    ]);
    fixture.detectChanges();

    expect(component.entry()).toBeNull();
  });

  it('allows admins to view draft articles with draft badge', () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'draft-slug');
    fixture.detectChanges();

    const internal = component as unknown as InternalComponentState;
    internal.subscribed.set(true);
    internal.postsLoading.set(false);
    internal.rawPosts.set([
      {
        id: '1',
        title: 'Draft Post',
        urlId: 'draft-slug',
        body: '<p>Secret</p>',
        excerpt: '',
        isDraft: true,
      } as CachedBlogPost,
    ]);
    fixture.detectChanges();

    expect(component.entry()).not.toBeNull();
    expect(component.entry()?.isDraft).toBe(true);

    const draftBadge = fixture.nativeElement.querySelector('.draft-badge');
    expect(draftBadge).not.toBeNull();
  });

  it('compiles bodyMarkdown to HTML when bodyMarkdown is present', () => {
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'markdown-slug');
    fixture.detectChanges();

    const internal = component as unknown as InternalComponentState;
    internal.subscribed.set(true);
    internal.postsLoading.set(false);
    internal.rawPosts.set([
      {
        id: '1',
        title: 'Markdown Article',
        urlId: 'markdown-slug',
        body: '<p>Legacy HTML</p>',
        bodyMarkdown: '## Subtitle\n\nParagraph 1\n\n\nParagraph 2\n\n- Dash item',
        excerpt: '',
        isDraft: false,
      } as CachedBlogPost,
    ]);
    fixture.detectChanges();

    const entry = component.entry();
    expect(entry).not.toBeNull();
    const blogBody = fixture.nativeElement.querySelector('.blog-body');
    expect(blogBody).not.toBeNull();
    expect(blogBody.querySelector('h2')?.textContent).toBe('Subtitle');
    expect(blogBody.querySelector('ul')?.getAttribute('data-bullet')).toBe('-');
    expect(blogBody.querySelector('p.empty-line')).not.toBeNull();
  });
});
