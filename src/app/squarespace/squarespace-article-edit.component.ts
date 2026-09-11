import {
  Component,
  effect,
  inject,
  input,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  setDoc,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import { FIREBASE_APP, Views, AppPathPatterns } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';
import { ImageUploadPreviewComponent } from '../image-upload-preview/image-upload-preview';
import { htmlToMarkdown } from './html-to-markdown';
import {
  CachedBlogPost,
  initCachedBlogPost,
  BlogPostStatus,
  BlogPostSourceKind,
} from '../../../functions/src/data-model/content-cache';
import { isDraftPost } from './squarespace-content.component';
import { FormsModule } from '@angular/forms';
import { compileMarkdownToHtml } from '../markdown-editor/markdown-config';

@Component({
  selector: 'app-squarespace-article-edit',
  standalone: true,
  imports: [FormsModule, SpinnerComponent, MarkdownEditor, ImageUploadPreviewComponent, IconComponent],
  templateUrl: './squarespace-article-edit.component.html',
  styleUrl: './squarespace-article-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SquarespaceArticleEditComponent {
  public firebaseService = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);

  // The Firestore collection name, e.g. 'articles-post', 'members-post', or 'instructors-post'.
  collection = input.required<string>();
  blogPostPath = input<string | null>(null);
  isNew = computed(() => !this.blogPostPath());
  slugManuallyEdited = signal<boolean>(false);

  public readonly BlogPostStatus = BlogPostStatus;

  post = signal<CachedBlogPost | null>(null);
  docId = signal<string>('');
  title = signal<string>('');
  urlId = signal<string>('');
  publishDateStr = signal<string>('');
  status = signal<BlogPostStatus>(BlogPostStatus.Published);
  isDraft = computed(() => this.status() === BlogPostStatus.Draft);
  categoriesStr = signal<string>('');
  tagsStr = signal<string>('');
  author = signal<string>('');
  assetUrl = signal<string>('');
  excerpt = signal<string>('');
  bodyMarkdown = signal<string>('');

  isEditingCrop = signal<boolean>(false);
  isUploadingImage = signal<boolean>(false);
  imageUploadError = signal<string | null>(null);
  showManualUrl = signal<boolean>(false);

  loading = signal<boolean>(true);
  isSaving = signal<boolean>(false);
  error = signal<string | null>(null);

  viewHref = computed(() => {
    const coll = this.collection();
    const slug = this.urlId() || this.blogPostPath();
    if (!slug) {
      if (coll === 'members-post') {
        return this.routingService.hrefForView(Views.MembersArea);
      } else if (coll === 'instructors-post') {
        return this.routingService.hrefForView(Views.InstructorsArea);
      }
      return this.routingService.hrefForView(Views.Articles);
    }
    if (coll === 'members-post') {
      return this.routingService.hrefForView(Views.MembersAreaPost, { blogPostPath: slug });
    } else if (coll === 'instructors-post') {
      return this.routingService.hrefForView(Views.InstructorsAreaPost, { blogPostPath: slug });
    }
    return this.routingService.hrefForView(Views.ArticlesPost, { blogPostPath: slug });
  });

  cancelHref = computed(() => {
    if (this.isNew()) {
      const coll = this.collection();
      if (coll === 'members-post') {
        return this.routingService.hrefForView(Views.MembersArea);
      } else if (coll === 'instructors-post') {
        return this.routingService.hrefForView(Views.InstructorsArea);
      }
      return this.routingService.hrefForView(Views.Articles);
    }
    return this.viewHref();
  });

  areaLabel = computed(() => {
    const coll = this.collection();
    if (coll === 'members-post') return 'Members Area';
    if (coll === 'instructors-post') return 'Instructors Area';
    return 'Articles & Guides';
  });

  constructor() {
    effect(() => {
      const coll = this.collection();
      const slug = this.blogPostPath();
      if (coll && slug) {
        this.loadPost(coll, slug);
      } else if (coll && !slug) {
        this.initNewPost(coll);
      } else {
        this.error.set('Configuration error: No collection specified.');
        this.loading.set(false);
      }
    });
  }

  initNewPost(coll: string) {
    if (!this.firebaseService.isAdmin()) {
      this.error.set('You do not have permission to create articles.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    // Pre-generate a unique Firestore doc ID so image uploads have a storage path immediately
    const newDocRef = doc(collection(this.db, coll));
    this.docId.set(newDocRef.id);
    this.post.set(null);

    this.title.set('');
    this.urlId.set('');
    this.slugManuallyEdited.set(false);

    const dateObj = new Date();
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    this.publishDateStr.set(`${yyyy}-${mm}-${dd}`);

    this.status.set(BlogPostStatus.Published);
    this.categoriesStr.set('');
    this.tagsStr.set('');

    const user = this.firebaseService.user();
    const authorName = user?.member?.name || user?.firebaseUser?.displayName || user?.firebaseUser?.email || 'Admin';
    this.author.set(authorName);

    this.assetUrl.set('');
    this.excerpt.set('');
    this.bodyMarkdown.set('');

    this.loading.set(false);
  }

  async loadPost(coll: string, slug: string) {
    if (!this.firebaseService.isAdmin()) {
      this.error.set('You do not have permission to edit articles.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const postsRef = collection(this.db, coll);
      const q = query(postsRef, where('urlId', '==', slug));
      const snap = await getDocs(q);
      let docSnap = snap.docs[0];

      if (!docSnap) {
        const direct = await getDoc(doc(this.db, coll, slug));
        if (direct.exists()) {
          docSnap = direct;
        }
      }

      if (!docSnap) {
        this.error.set('Article not found.');
        this.loading.set(false);
        return;
      }

      const data: CachedBlogPost = {
        ...initCachedBlogPost(),
        ...(docSnap.data() as CachedBlogPost),
      };

      this.docId.set(docSnap.id);
      this.post.set(data);
      this.title.set(data.title || '');
      this.urlId.set(data.urlId || '');

      const ts = data.publishOn || data.addedOn || Date.now();
      const dateObj = new Date(ts);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      this.publishDateStr.set(`${yyyy}-${mm}-${dd}`);

      const isDraftVal = isDraftPost(data);
      const postStatus = isDraftVal ? BlogPostStatus.Draft : (data.status === BlogPostStatus.Draft ? BlogPostStatus.Draft : BlogPostStatus.Published);
      this.status.set(postStatus);
      this.categoriesStr.set((data.categories || []).join(', '));
      this.tagsStr.set((data.tags || []).join(', '));
      this.author.set(data.author || '');
      this.assetUrl.set(data.assetUrl || '');
      this.excerpt.set(data.excerpt || '');

      if (data.bodyMarkdown && data.bodyMarkdown.trim()) {
        this.bodyMarkdown.set(data.bodyMarkdown);
      } else if (data.body) {
        this.bodyMarkdown.set(htmlToMarkdown(data.body));
      } else {
        this.bodyMarkdown.set('');
      }

      this.loading.set(false);
    } catch (err: unknown) {
      console.error('Error loading article for edit:', err);
      this.error.set((err as Error).message || 'Failed to load article.');
      this.loading.set(false);
    }
  }

  onMarkdownChange(val: string) {
    this.bodyMarkdown.set(val);
  }

  onTitleInput(val: string) {
    this.title.set(val);
    if (this.isNew() && !this.slugManuallyEdited()) {
      this.generateSlugFromTitle();
    }
  }

  onSlugInput(val: string) {
    this.urlId.set(val);
    this.slugManuallyEdited.set(true);
  }

  generateSlugFromTitle() {
    const t = this.title();
    if (!t) return;
    const slug = t
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    this.urlId.set(slug);
  }

  async onImageCropped(event: { thumbBlob: Blob; largeBlob: Blob; originalFile?: File }) {
    if (!event.originalFile && this.assetUrl()) {
      // Image was already uploaded and no new file was selected; keep existing image without re-uploading
      this.isEditingCrop.set(false);
      return;
    }

    const coll = this.collection();
    const docId = this.docId();
    if (!docId) {
      this.imageUploadError.set('Cannot upload image: document ID is missing.');
      return;
    }

    this.isUploadingImage.set(true);
    this.imageUploadError.set(null);

    try {
      const storage = getStorage(this.firebaseApp);
      const filename = `hero_${Date.now()}`;
      const imageStorageRef = storageRef(storage, `${coll}/${docId}/images/${filename}`);
      await uploadBytes(imageStorageRef, event.largeBlob);
      const downloadUrl = await getDownloadURL(imageStorageRef);

      this.assetUrl.set(downloadUrl);
      this.isEditingCrop.set(false);
    } catch (err: unknown) {
      console.error('Error uploading image:', err);
      this.imageUploadError.set((err as Error).message || 'Failed to upload image.');
    } finally {
      this.isUploadingImage.set(false);
    }
  }

  uploadArticleImage = async (blob: Blob, meta: { originalFile?: File; altText?: string }): Promise<string> => {
    const coll = this.collection();
    const docId = this.docId();
    if (!docId) {
      throw new Error('Cannot upload image: document ID is missing.');
    }
    const storage = getStorage(this.firebaseApp);
    const filename = `body_${Date.now()}_${meta.originalFile?.name || 'image.png'}`;
    const imageStorageRef = storageRef(storage, `${coll}/${docId}/images/${filename}`);
    await uploadBytes(imageStorageRef, blob, { contentType: blob.type || 'image/png' });
    return await getDownloadURL(imageStorageRef);
  };

  onStatusChange(value: string) {
    const nextStatus = value === BlogPostStatus.Draft ? BlogPostStatus.Draft : BlogPostStatus.Published;
    this.status.set(nextStatus);
  }

  cancelCrop() {
    this.isEditingCrop.set(false);
  }

  removeImage() {
    this.assetUrl.set('');
    this.isEditingCrop.set(false);
  }

  cancel() {
    if (this.isNew()) {
      const coll = this.collection();
      if (coll === 'members-post') {
        this.routingService.navigateTo('/members-area');
      } else if (coll === 'instructors-post') {
        this.routingService.navigateTo('/instructors-area');
      } else {
        this.routingService.navigateTo('/articles');
      }
      return;
    }
    const href = this.viewHref();
    if (href) {
      this.routingService.navigateTo(href);
    }
  }

  async save() {
    const trimmedTitle = this.title().trim();
    const trimmedSlug = this.urlId().trim();

    if (!trimmedTitle) {
      this.error.set('Article title is required.');
      return;
    }
    if (!trimmedSlug) {
      this.error.set('Article URL slug is required.');
      return;
    }

    this.isSaving.set(true);
    this.error.set(null);

    try {
      const coll = this.collection();
      const postsRef = collection(this.db, coll);

      // Check slug uniqueness within collection
      const q = query(postsRef, where('urlId', '==', trimmedSlug));
      const snap = await getDocs(q);
      const existingMatchingDoc = snap.docs.find((d) => d.id !== this.docId());
      if (existingMatchingDoc) {
        this.error.set(`An article with the URL slug "${trimmedSlug}" already exists. Please choose a different slug.`);
        this.isSaving.set(false);
        return;
      }

      const directDoc = await getDoc(doc(this.db, coll, trimmedSlug));
      if (directDoc.exists() && directDoc.id !== this.docId()) {
        this.error.set(`An article with the slug "${trimmedSlug}" already exists. Please choose a different slug.`);
        this.isSaving.set(false);
        return;
      }

      const rawMarkdown = this.bodyMarkdown();
      const compiledHtml = compileMarkdownToHtml(rawMarkdown);
      const cats = this.categoriesStr()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const tags = this.tagsStr()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const isDraftVal = this.isDraft();

      let publishTimestamp = this.post()?.publishOn || Date.now();
      if (this.publishDateStr()) {
        const parsed = new Date(this.publishDateStr() + 'T12:00:00Z').getTime();
        if (!isNaN(parsed)) {
          publishTimestamp = parsed;
        }
      }

      const nowIso = new Date().toISOString();

      if (this.isNew()) {
        const newPost: CachedBlogPost = {
          ...initCachedBlogPost(),
          id: this.docId(),
          title: trimmedTitle,
          urlId: trimmedSlug,
          bodyMarkdown: rawMarkdown,
          body: compiledHtml,
          excerpt: this.excerpt().trim(),
          assetUrl: this.assetUrl().trim(),
          author: this.author().trim(),
          categories: cats,
          tags: tags,
          isDraft: isDraftVal,
          status: isDraftVal ? BlogPostStatus.Draft : BlogPostStatus.Published,
          kind: BlogPostSourceKind.FirebaseSourced,
          publishOn: publishTimestamp,
          addedOn: publishTimestamp,
          lastUpdated: nowIso,
        };

        await setDoc(doc(this.db, coll, this.docId()), newPost);
      } else {
        await updateDoc(doc(this.db, coll, this.docId()), {
          title: trimmedTitle,
          urlId: trimmedSlug,
          bodyMarkdown: rawMarkdown,
          body: compiledHtml,
          excerpt: this.excerpt().trim(),
          assetUrl: this.assetUrl().trim(),
          author: this.author().trim(),
          categories: cats,
          tags: tags,
          isDraft: isDraftVal,
          status: isDraftVal ? BlogPostStatus.Draft : BlogPostStatus.Published,
          kind: BlogPostSourceKind.FirebaseSourced,
          publishOn: publishTimestamp,
          lastUpdated: nowIso,
        });
      }

      this.isSaving.set(false);

      // Navigate to the article view
      let targetPath = `/articles/post/${trimmedSlug}`;
      if (coll === 'members-post') {
        targetPath = `/members-area/post/${trimmedSlug}`;
      } else if (coll === 'instructors-post') {
        targetPath = `/instructors-area/post/${trimmedSlug}`;
      }
      this.routingService.navigateTo(targetPath);
    } catch (err: unknown) {
      console.error('Error saving article:', err);
      this.error.set((err as Error).message || 'Failed to save article.');
      this.isSaving.set(false);
    }
  }
}
