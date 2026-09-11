import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { SquarespaceArticleEditComponent } from './squarespace-article-edit.component';
import { RoutingService } from '../routing.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { FIREBASE_APP } from '../app.config';
import { initializeApp } from 'firebase/app';
import { getDocs, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  CachedBlogPost,
  BlogPostStatus,
  BlogPostSourceKind,
} from '../../../functions/src/data-model/content-cache';

// Mock firebase/firestore
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn().mockImplementation((...args: any[]) => {
    if (args.length === 1) return { id: 'auto-generated-id' };
    if (args.length === 2) return { id: args[1] };
    return { id: args[2] || 'auto-generated-id' };
  }),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  setDoc: vi.fn().mockResolvedValue(undefined),
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
    component.onStatusChange(BlogPostStatus.Draft);
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

  it('does not re-upload image if assetUrl is already set and no new file was selected', async () => {
    component.docId.set('doc-123');
    component.assetUrl.set('https://example.com/existing-image.jpg');
    component.isEditingCrop.set(true);

    const fakeLargeBlob = new Blob(['fake image content'], { type: 'image/jpeg' });
    const fakeThumbBlob = new Blob(['fake thumb content'], { type: 'image/jpeg' });

    vi.clearAllMocks();

    await component.onImageCropped({
      thumbBlob: fakeThumbBlob,
      largeBlob: fakeLargeBlob,
      originalFile: undefined,
    });

    expect(uploadBytes).not.toHaveBeenCalled();
    expect(component.assetUrl()).toBe('https://example.com/existing-image.jpg');
    expect(component.isEditingCrop()).toBe(false);
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

  it('configures hero image uploader with original ratio default and storageKey', async () => {
    vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
    (getDocs as any).mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'doc-firestore-id-123',
          data: () => ({ ...mockPostData, assetUrl: 'https://example.com/hero.jpg' }),
        },
      ],
    });

    fixture.componentRef.setInput('collection', 'articles-post');
    fixture.componentRef.setInput('blogPostPath', 'my-sample-article');
    fixture.detectChanges();
    await component.loadPost('articles-post', 'my-sample-article');
    component.isEditingCrop.set(true);
    fixture.detectChanges();

    const uploader = fixture.nativeElement.querySelector('app-image-upload-preview');
    expect(uploader).toBeTruthy();
  });

  describe('New Article Mode', () => {
    it('initializes in new article mode with pre-generated docId and defaults', () => {
      vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
      fixture.componentRef.setInput('collection', 'articles-post');
      fixture.componentRef.setInput('blogPostPath', null);
      fixture.detectChanges();

      expect(component.isNew()).toBe(true);
      expect(component.docId()).toBeTruthy();
      expect(component.title()).toBe('');
      expect(component.urlId()).toBe('');
      expect(component.publishDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(component.status()).toBe(BlogPostStatus.Published);
      expect(component.isDraft()).toBe(false);
      expect(component.loading()).toBe(false);
      expect(component.error()).toBeNull();
    });

    it('rejects non-admin users in new article mode', () => {
      vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(false);
      fixture.componentRef.setInput('collection', 'articles-post');
      fixture.componentRef.setInput('blogPostPath', null);
      fixture.detectChanges();

      expect(component.error()).toBe('You do not have permission to create articles.');
      expect(component.loading()).toBe(false);
    });

    it('auto-generates slug from title when typing title and respects manual edits', () => {
      vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
      fixture.componentRef.setInput('collection', 'articles-post');
      fixture.componentRef.setInput('blogPostPath', null);
      fixture.detectChanges();

      component.onTitleInput('Understanding Zhong Xin Dao: Part 1');
      expect(component.urlId()).toBe('understanding-zhong-xin-dao-part-1');

      // User manually customizes slug
      component.onSlugInput('custom-zxd-intro');
      expect(component.urlId()).toBe('custom-zxd-intro');

      // Typing title further will no longer overwrite manual slug
      component.onTitleInput('Understanding Zhong Xin Dao: Part 2');
      expect(component.urlId()).toBe('custom-zxd-intro');
    });

    it('rejects saving when slug already exists in collection', async () => {
      vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
      fixture.componentRef.setInput('collection', 'articles-post');
      fixture.componentRef.setInput('blogPostPath', null);
      fixture.detectChanges();

      component.title.set('Duplicate Article');
      component.urlId.set('existing-slug');

      (getDocs as any).mockResolvedValue({
        empty: false,
        docs: [{ id: 'other-doc-id', data: () => ({ urlId: 'existing-slug' }) }],
      });

      await component.save();

      expect(component.error()).toBe('An article with the URL slug "existing-slug" already exists. Please choose a different slug.');
      expect(setDoc).not.toHaveBeenCalled();
      expect(updateDoc).not.toHaveBeenCalled();
    });

    it('rejects saving when slug collides with an existing document ID', async () => {
      vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
      fixture.componentRef.setInput('collection', 'articles-post');
      fixture.componentRef.setInput('blogPostPath', null);
      fixture.detectChanges();

      component.title.set('Existing Doc ID');
      component.urlId.set('doc-with-slug-id');

      (getDocs as any).mockResolvedValue({ empty: true, docs: [] });
      (getDoc as any).mockResolvedValue({ exists: () => true, id: 'doc-with-slug-id' });

      await component.save();

      expect(component.error()).toBe('An article with the slug "doc-with-slug-id" already exists. Please choose a different slug.');
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('creates new article via setDoc with FirebaseSourced kind and navigates to article view', async () => {
      vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
      fixture.componentRef.setInput('collection', 'articles-post');
      fixture.componentRef.setInput('blogPostPath', null);
      fixture.detectChanges();

      (getDocs as any).mockResolvedValue({ empty: true, docs: [] });
      (getDoc as any).mockResolvedValue({ exists: () => false });

      component.title.set('Brand New Article');
      component.urlId.set('brand-new-article');
      component.bodyMarkdown.set('# Hello World\n\nFirst paragraph.');
      component.excerpt.set('First paragraph teaser');
      component.categoriesStr.set('Training, Philosophy');
      component.tagsStr.set('basics');
      component.publishDateStr.set('2026-01-15');

      await component.save();

      expect(setDoc).toHaveBeenCalledTimes(1);
      const callArgs = (setDoc as any).mock.calls[0];
      const savedDocRef = callArgs[0];
      const savedData = callArgs[1] as CachedBlogPost;

      expect(savedDocRef.id).toBe(component.docId());
      expect(savedData.title).toBe('Brand New Article');
      expect(savedData.urlId).toBe('brand-new-article');
      expect(savedData.kind).toBe(BlogPostSourceKind.FirebaseSourced);
      expect(savedData.status).toBe(BlogPostStatus.Published);
      expect(savedData.isDraft).toBe(false);
      expect(savedData.categories).toEqual(['Training', 'Philosophy']);
      expect(savedData.tags).toEqual(['basics']);
      expect(savedData.bodyMarkdown).toBe('# Hello World\n\nFirst paragraph.');
      expect(savedData.body).toContain('<h1>Hello World</h1>');
      expect(savedData.body).toContain('<p>First paragraph.</p>');
      expect(savedData.excerpt).toBe('First paragraph teaser');
      expect(savedData.publishOn).toBe(new Date('2026-01-15T12:00:00Z').getTime());

      expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('/articles/post/brand-new-article');
    });

    it('cancels new article by navigating back to collection list', () => {
      vi.spyOn(firebaseServiceMock, 'isAdmin').mockReturnValue(true);
      fixture.componentRef.setInput('collection', 'members-post');
      fixture.componentRef.setInput('blogPostPath', null);
      fixture.detectChanges();

      component.cancel();
      expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('/members-area');

      fixture.componentRef.setInput('collection', 'instructors-post');
      fixture.detectChanges();
      component.cancel();
      expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('/instructors-area');

      fixture.componentRef.setInput('collection', 'articles-post');
      fixture.detectChanges();
      component.cancel();
      expect(routingServiceMock.navigateTo).toHaveBeenCalledWith('/articles');
    });
  });
});
