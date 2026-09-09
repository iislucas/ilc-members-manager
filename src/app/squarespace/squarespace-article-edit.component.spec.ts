import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { SquarespaceArticleEditComponent } from './squarespace-article-edit.component';
import { RoutingService } from '../routing.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { FIREBASE_APP } from '../app.config';
import { initializeApp } from 'firebase/app';
import { getDocs, getDoc, updateDoc } from 'firebase/firestore';
import { uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  CachedBlogPost,
  BlogPostStatus,
  BlogPostSourceKind,
} from '../../../functions/src/data-model/content-cache';

// Mock firebase/firestore
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn().mockImplementation((_db: unknown, _coll: string, id: string) => ({ id })),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
}));

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(),
  ref: vi.fn().mockImplementation((_storage: unknown, path: string) => ({ path })),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.googleapis.com/test-bucket/image.jpg'),
}));

describe('SquarespaceArticleEditComponent', () => {
  let component: SquarespaceArticleEditComponent;
  let fixture: ComponentFixture<SquarespaceArticleEditComponent>;
  let routingServiceMock: Partial<RoutingService<never>>;
  let firebaseServiceMock: FirebaseStateService;

  const mockPostData: CachedBlogPost = {
    id: 'post-123',
    urlId: 'my-sample-article',
    title: 'My Sample Article',
    excerpt: 'Short excerpt',
    body: '<h2>Overview</h2><p>Article body with <strong>bold</strong> text.</p>',
    bodyMarkdown: '',
    assetUrl: 'https://example.com/hero.jpg',
    publishOn: 1600000000000,
    addedOn: 1600000000000,
    categories: ['News', 'Articles'],
    tags: ['sample', 'test'],
    author: 'Master Sam Chin',
    kind: BlogPostSourceKind.WordPress,
    isDraft: false,
    status: BlogPostStatus.Published,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    routingServiceMock = {
      navigateTo: vi.fn(),
      hrefForView: vi.fn((view: string, vars?: Record<string, string>) => `/${view}/${vars?.['blogPostPath'] || ''}`),
      signals: {},
    } as unknown as RoutingService<never>;

    firebaseServiceMock = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [SquarespaceArticleEditComponent],
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
            `test-sqsp-edit-${Math.random()}`,
          ),
        },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(SquarespaceArticleEditComponent);
    component = fixture.componentInstance;
  });

  it('rejects non-admin users with permission error', async () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(false);
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'my-sample-article');
    fixture.detectChanges();

    await component.loadPost('articles-post', 'my-sample-article');

    expect(component.error()).toBe('You do not have permission to edit articles.');
    expect(component.loading()).toBe(false);
  });

  it('loads post data and converts HTML to Markdown when bodyMarkdown is empty', async () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    (getDocs as any).mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'doc-firestore-id-123',
          data: () => ({ ...mockPostData, bodyMarkdown: '' }),
        },
      ],
    });

    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'my-sample-article');
    fixture.detectChanges();

    await component.loadPost('articles-post', 'my-sample-article');

    expect(component.docId()).toBe('doc-firestore-id-123');
    expect(component.title()).toBe('My Sample Article');
    expect(component.urlId()).toBe('my-sample-article');
    expect(component.isDraft()).toBe(false);
    expect(component.categoriesStr()).toBe('News, Articles');
    expect(component.tagsStr()).toBe('sample, test');
    expect(component.author()).toBe('Master Sam Chin');
    expect(component.assetUrl()).toBe('https://example.com/hero.jpg');
    expect(component.excerpt()).toBe('Short excerpt');
    expect(component.publishDateStr()).toBeTruthy();

    // Converted HTML to Markdown
    expect(component.bodyMarkdown()).toBe('## Overview\n\nArticle body with **bold** text.');
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
  });

  it('uses existing bodyMarkdown if already present', async () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    (getDocs as any).mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'doc-123',
          data: () => ({
            ...mockPostData,
            bodyMarkdown: '# Custom Markdown\n\nExisting markdown content.',
          }),
        },
      ],
    });

    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'my-sample-article');
    fixture.detectChanges();

    await component.loadPost('articles-post', 'my-sample-article');

    expect(component.bodyMarkdown()).toBe('# Custom Markdown\n\nExisting markdown content.');
  });

  it('sets error if article is not found', async () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    (getDocs as any).mockResolvedValue({ empty: true, docs: [] });
    (getDoc as any).mockResolvedValue({ exists: () => false });

    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'non-existent');
    fixture.detectChanges();

    await component.loadPost('articles-post', 'non-existent');

    expect(component.error()).toBe('Article not found.');
    expect(component.loading()).toBe(false);
  });

  it('saves updated article content to Firestore and navigates to article view', async () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    (getDocs as any).mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'doc-save-id',
          data: () => ({ ...mockPostData, bodyMarkdown: '# Original Title' }),
        },
      ],
    });

    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'my-sample-article');
    fixture.detectChanges();

    await component.loadPost('articles-post', 'my-sample-article');

    // Edit fields
    component.title.set('Updated Article Title');
    component.urlId.set('updated-slug');
    component.publishDateStr.set('2025-06-15');
    component.isDraft.set(true);
    component.bodyMarkdown.set('# Updated Title\n\nBrand new markdown body.');
    component.categoriesStr.set('Philosophy, Zen');
    component.tagsStr.set('mindfulness, presence');

    await component.save();

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const updatedPayload = (updateDoc as any).mock.calls[0][1];
    expect(updatedPayload.title).toBe('Updated Article Title');
    expect(updatedPayload.urlId).toBe('updated-slug');
    expect(updatedPayload.isDraft).toBe(true);
    expect(updatedPayload.status).toBe(BlogPostStatus.Draft);
    expect(updatedPayload.kind).toBe(BlogPostSourceKind.FirebaseSourced);
    expect(updatedPayload.categories).toEqual(['Philosophy', 'Zen']);
    expect(updatedPayload.tags).toEqual(['mindfulness', 'presence']);
    expect(updatedPayload.bodyMarkdown).toBe('# Updated Title\n\nBrand new markdown body.');
    // Check that body was compiled to HTML
    expect(updatedPayload.body).toContain('<h1>Updated Title</h1>');
    expect(updatedPayload.body).toContain('<p>Brand new markdown body.</p>');
    expect(updatedPayload.lastUpdated).toBeDefined();
    expect(updatedPayload.publishOn).toBe(new Date('2025-06-15T12:00:00Z').getTime());

    // Verify navigation to the updated path
    expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('/articles/post/updated-slug');
  });

  it('validates that title and slug cannot be empty on save', async () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    component.docId.set('doc-test');
    component.title.set('');
    component.urlId.set('test-slug');

    await component.save();
    expect(component.error()).toBe('Article title is required.');
    expect(updateDoc).not.toHaveBeenCalled();

    component.title.set('Valid Title');
    component.urlId.set('');

    await component.save();
    expect(component.error()).toBe('Article URL slug is required.');
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('auto-generates slug from title', () => {
    component.title.set('Spinning & Sticky Hands: Part 2!');
    component.generateSlugFromTitle();
    expect(component.urlId()).toBe('spinning-sticky-hands-part-2');
  });

  it('uploads cropped image to Firebase Storage and updates assetUrl', async () => {
    component.docId.set('doc-123');
    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'my-sample-article');
    fixture.detectChanges();

    const fakeLargeBlob = new Blob(['fake image content'], { type: 'image/jpeg' });
    const fakeThumbBlob = new Blob(['fake thumb content'], { type: 'image/jpeg' });

    component.isEditingCrop.set(true);

    await component.onImageCropped({
      thumbBlob: fakeThumbBlob,
      largeBlob: fakeLargeBlob,
    });

    expect(uploadBytes).toHaveBeenCalledTimes(1);
    expect(getDownloadURL).toHaveBeenCalledTimes(1);
    expect(component.assetUrl()).toBe('https://storage.googleapis.com/test-bucket/image.jpg');
    expect(component.isEditingCrop()).toBe(false);
    expect(component.imageUploadError()).toBeNull();
  });

  it('cancels crop editing and clears image correctly', () => {
    component.isEditingCrop.set(true);
    component.cancelCrop();
    expect(component.isEditingCrop()).toBe(false);

    component.assetUrl.set('https://example.com/existing.jpg');
    component.isEditingCrop.set(true);
    component.removeImage();
    expect(component.assetUrl()).toBe('');
    expect(component.isEditingCrop()).toBe(false);
  });

  it('cancel navigates back to viewHref', () => {
    fixture.componentRef.setInput('collection', 'members-post');
    fixture.componentRef.setInput('blogPostPath', 'member-post-slug');
    fixture.detectChanges();

    component.cancel();
    expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('/membersAreaPost/member-post-slug');
  });
});
