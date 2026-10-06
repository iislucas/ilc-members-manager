import { Component, effect, inject, input, ViewEncapsulation, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    getFirestore,
    Unsubscribe,
} from 'firebase/firestore';
import { FIREBASE_APP } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { BlogPostStatus, CachedBlogPost, initCachedBlogPost, isDraftPost } from '../../../functions/src/data-model/content-cache';
import {
    MembershipType,
    ExpiryStatus,
    hasActiveMembership,
    satisfiesMemberStatusLevel,
    toMemberStatusContext,
    MemberStatusLevel,
} from '../../../functions/src/data-model/members';
import { IconComponent, IconName } from '../icons/icon.component';
import { getInstructorExpiryStatus } from '../member-tags';
import { compileMarkdownToHtml } from '../markdown-editor/markdown-config';

export type PillTabVariant = 'default' | 'admin-chip';

export interface PillTabItem {
    id: string;
    label: string;
    variant: PillTabVariant;
    icon?: IconName;
    href?: string;
    isAction?: boolean;
}

export interface ProcessedBlogEntry extends CachedBlogPost {
    safeBody: SafeHtml;
    safeExcerpt: SafeHtml;
}

export function normalizeCategory(c: string, collectionName?: string): string {
    if (collectionName === 'instructors-post' && (c === 'Learn' || c === 'Articles')) return 'Article';
    if (c === 'Articles') return 'Article';
    if (c === 'Announcements') return 'Announcement';
    return c;
}

export function categoryToTabLabel(cat: string): string {
    if (cat === 'Article') return 'Articles';
    if (cat === 'Announcement') return 'Announcements';
    return cat;
}

export { isDraftPost };

@Component({
    selector: 'app-squarespace-content',
    standalone: true,
    imports: [CommonModule, SpinnerComponent, IconComponent],
    templateUrl: './squarespace-content.component.html',
    styleUrls: ['./squarespace-content.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class SquarespaceContentComponent implements OnDestroy {
    private sanitizer = inject(DomSanitizer);
    public firebaseService = inject(FirebaseStateService);
    private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
    private firebaseApp = inject(FIREBASE_APP);
    private db = getFirestore(this.firebaseApp);
    private unsubscribe: Unsubscribe | null = null;

    // The Firestore collection name, e.g. 'members-post' or 'instructors-post'.
    path = input.required<string>();

    selectedCategory = signal<string>('All');
    fallbackContent = signal<SafeHtml | null>(null);
    error = signal<string | null>(null);

    // Raw posts from Firestore.
    private rawPosts = signal<CachedBlogPost[]>([]);
    private subscribed = signal(false);

    onImageError(event: Event) {
        const img = event.target as HTMLElement;
        const container = img.closest('.blog-image') as HTMLElement | null;
        if (container) {
            container.style.display = 'none';
        }
    }

    tabLabel(cat: string): string {
        return categoryToTabLabel(cat);
    }

    // Process cached posts into template-ready entries with sanitised HTML.
    readonly blogEntries = computed<ProcessedBlogEntry[]>(() => {
        if (!this.subscribed()) return [];
        const coll = this.path();
        const isAdmin = this.firebaseService.isAdmin();
        return this.rawPosts()
            .filter((item) => isAdmin || !isDraftPost(item))
            .map((item) => {
                const categories = item.categories?.map((c) => normalizeCategory(c, coll)) ?? [];
                const rawBody = item.bodyMarkdown
                    ? compileMarkdownToHtml(item.bodyMarkdown)
                    : (item.body || '');
                return {
                    ...item,
                    isDraft: isDraftPost(item),
                    categories,
                    safeBody: this.sanitizer.bypassSecurityTrustHtml(rawBody),
                    safeExcerpt: this.sanitizer.bypassSecurityTrustHtml(item.excerpt),
                };
            });
    });

    readonly categories = computed<string[]>(() => {
        const entries = this.blogEntries();
        if (entries.length === 0) return [];
        const isArticles = this.path() === 'articles-post';
        const allCategories = new Set<string>();
        let hasDrafts = false;
        entries.forEach(item => {
            if (isDraftPost(item)) {
                hasDrafts = true;
                return;
            }
            if (item.categories) {
                item.categories.forEach((c: string) => {
                    if (isArticles && (c.toLowerCase() === 'instructors' || c.toLowerCase() === 'instructor')) {
                        return;
                    }
                    allCategories.add(c);
                });
            }
        });
        const list = ['All', ...Array.from(allCategories).sort()];
        if (this.firebaseService.isAdmin() && hasDrafts) {
            list.push('Drafts');
        }
        return list;
    });

    readonly tabs = computed<PillTabItem[]>(() => {
        const categories = this.categories();
        const isAdmin = this.firebaseService.isAdmin();
        if (categories.length === 0 && !isAdmin) return [];

        const items: PillTabItem[] = [];

        for (const cat of categories) {
            const isDraft = cat === 'Drafts';
            items.push({
                id: cat,
                label: this.tabLabel(cat),
                variant: isDraft ? 'admin-chip' : 'default',
            });
        }

        if (isAdmin) {
            items.push({
                id: 'new-article',
                label: 'New Article',
                variant: 'admin-chip',
                icon: 'add',
                href: this.newArticleHref(),
                isAction: true,
            });
        }

        return items;
    });

    readonly loading = computed(() => {
        if (this.error()) return false;
        if (!this.subscribed()) return true;
        return this.postsLoading();
    });

    readonly draftCount = computed<number>(() => {
        if (!this.firebaseService.isAdmin()) return 0;
        return this.blogEntries().filter((e) => isDraftPost(e)).length;
    });

    private postsLoading = signal(true);

    filteredEntries = computed(() => {
        const cat = this.selectedCategory();
        const entries = this.blogEntries();
        const isAdmin = this.firebaseService.isAdmin();
        if (cat === 'Drafts') {
            return isAdmin ? entries.filter(e => isDraftPost(e)) : [];
        }
        return entries.filter(e => !isDraftPost(e) && (cat === 'All' || (e.categories && e.categories.includes(cat))));
    });

    constructor() {
        // Main effect: check access then subscribe to the Firestore collection.
        effect(() => {
            const collectionName = this.path();
            if (collectionName) {
                this.checkAccessAndSubscribe(collectionName);
            } else {
                this.error.set('Configuration error: No collection specified.');
            }
        });

        // Sync the selected category from the URL.
        effect(() => {
            const patternId = this.routingService.matchedPatternId();
            if (patternId === Views.MembersArea
                || patternId === Views.InstructorsArea
                || patternId === Views.Articles
                || patternId === Views.MembersAreaCategory
                || patternId === Views.InstructorsAreaCategory
                || patternId === Views.ArticlesCategory) {
                let urlCat = '';
                if (patternId === Views.MembersArea) {
                    urlCat = this.routingService.signals[Views.MembersArea].urlParams.category() || 'All';
                } else if (patternId === Views.MembersAreaCategory) {
                    urlCat = this.routingService.signals[Views.MembersAreaCategory].pathVars.category();
                } else if (patternId === Views.InstructorsArea) {
                    urlCat = this.routingService.signals[Views.InstructorsArea].urlParams.category() || 'All';
                } else if (patternId === Views.InstructorsAreaCategory) {
                    urlCat = this.routingService.signals[Views.InstructorsAreaCategory].pathVars.category();
                } else if (patternId === Views.Articles) {
                    urlCat = this.routingService.signals[Views.Articles].urlParams.category() || 'All';
                } else if (patternId === Views.ArticlesCategory) {
                    urlCat = this.routingService.signals[Views.ArticlesCategory].pathVars.category();
                }

                urlCat = decodeURIComponent(urlCat || 'All');
                urlCat = normalizeCategory(urlCat, this.path());

                // Redirect non-admins away from Drafts
                if (!this.firebaseService.isAdmin() && urlCat.toLowerCase() === 'drafts') {
                    this.selectCategory('All');
                    return;
                }

                if (this.path() === 'articles-post' && (urlCat.toLowerCase() === 'instructors' || urlCat.toLowerCase() === 'instructor')) {
                    this.selectCategory('All');
                    return;
                }

                if (urlCat) {
                    if (urlCat !== this.selectedCategory()) {
                        this.selectedCategory.set(urlCat);
                    }
                } else {
                    if (this.selectedCategory() !== 'All') {
                        this.selectedCategory.set('All');
                    }
                }
            }
        });
    }

    ngOnDestroy(): void {
        this.unsubscribe?.();
    }

    selectCategory(cat: string) {
        this.selectedCategory.set(cat);
        const patternId = this.routingService.matchedPatternId();
        const urlSlug = cat === 'All' ? 'All' : categoryToTabLabel(cat);
        const encodedCat = encodeURIComponent(urlSlug);

        if (patternId === Views.MembersArea) {
            this.routingService.signals[Views.MembersArea].urlParams.category.set(cat === 'All' ? '' : urlSlug);
        } else if (patternId === Views.InstructorsArea) {
            this.routingService.signals[Views.InstructorsArea].urlParams.category.set(cat === 'All' ? '' : urlSlug);
        } else if (patternId === Views.Articles) {
            this.routingService.signals[Views.Articles].urlParams.category.set(cat === 'All' ? '' : urlSlug);
        } else if (patternId === Views.MembersAreaCategory) {
            this.routingService.navigateToParts(cat === 'All' ? ['members-area', 'category', 'All'] : ['members-area', 'category', encodedCat]);
        } else if (patternId === Views.InstructorsAreaCategory) {
            this.routingService.navigateToParts(cat === 'All' ? ['instructors-area', 'category', 'All'] : ['instructors-area', 'category', encodedCat]);
        } else if (patternId === Views.ArticlesCategory) {
            this.routingService.navigateToParts(cat === 'All' ? ['articles', 'category', 'All'] : ['articles', 'category', encodedCat]);
        }
    }

    categoryHref(cat: string): string {
        const urlSlug = cat === 'All' ? 'All' : categoryToTabLabel(cat);
        const encodedCat = encodeURIComponent(urlSlug);
        const coll = this.path();
        if (coll === 'members-post') {
            return `/members-area/category/${encodedCat}`;
        } else if (coll === 'instructors-post') {
            return `/instructors-area/category/${encodedCat}`;
        }
        return `/articles/category/${encodedCat}`;
    }

    articleHref(entry: ProcessedBlogEntry): string {
        const coll = this.path();
        if (coll === 'members-post') {
            return `/members-area/post/${entry.urlId}`;
        } else if (coll === 'instructors-post') {
            return `/instructors-area/post/${entry.urlId}`;
        }
        return `/articles/post/${entry.urlId}`;
    }

    navigateToArticle(entry: ProcessedBlogEntry) {
        const href = this.articleHref(entry);
        this.routingService.navigateTo(href.startsWith('/') ? href.substring(1) : href);
    }

    editHrefFor(entry: ProcessedBlogEntry): string {
        const collectionName = this.path();
        if (collectionName === 'members-post') {
            return this.routingService.hrefForView(Views.MembersAreaPostEdit, { blogPostPath: entry.urlId });
        } else if (collectionName === 'instructors-post') {
            return this.routingService.hrefForView(Views.InstructorsAreaPostEdit, { blogPostPath: entry.urlId });
        }
        return this.routingService.hrefForView(Views.ArticlesPostEdit, { blogPostPath: entry.urlId });
    }

    newArticleHref(): string {
        const collectionName = this.path();
        if (collectionName === 'members-post') {
            return this.routingService.hrefForView(Views.MembersAreaPostNew);
        } else if (collectionName === 'instructors-post') {
            return this.routingService.hrefForView(Views.InstructorsAreaPostNew);
        }
        return this.routingService.hrefForView(Views.ArticlesPostNew);
    }

    private isActiveMember(): boolean {
        const m = this.firebaseService.user()?.member;
        return m ? hasActiveMembership(m) : false;
    }

    public checkAccessAndSubscribe(collectionName: string) {
        const isPublicArea = collectionName === 'articles-post';
        if (isPublicArea) {
            this.subscribeToCollection(collectionName);
            return;
        }

        const user = this.firebaseService.user();

        if (!user) {
            this.error.set('You must be logged in to view this content.');
            return;
        }

        const ctx = toMemberStatusContext(user);

        if (ctx.isAdmin) {
            this.subscribeToCollection(collectionName);
            return;
        }

        const isMemberArea = collectionName === 'members-post';
        const isInstructorArea = collectionName === 'instructors-post';

        if (isMemberArea) {
            if (!satisfiesMemberStatusLevel(ctx, MemberStatusLevel.ActiveMember)) {
                if (!user.member?.currentMembershipExpires || (user.member?.currentMembershipExpires && new Date(user.member.currentMembershipExpires) < new Date())) {
                    this.error.set('Your membership has expired. Please renew your membership to access this content.');
                } else {
                    this.error.set('You must be an active member to view this content.');
                }
                return;
            }
        } else if (isInstructorArea) {
            if (!user.member?.instructorId) {
                this.error.set('You must be an instructor to view this content.');
                return;
            }
            if (!satisfiesMemberStatusLevel(ctx, MemberStatusLevel.ActiveInstructor)) {
                if (!hasActiveMembership(user.member)) {
                    this.error.set('Your membership has expired. Active membership is required to access instructor content. Please renew your membership.');
                } else {
                    this.error.set('Your instructor license has expired. Please renew your instructor license to access this content.');
                }
                return;
            }
        }

        // Subscribe directly to the Firestore collection.
        this.subscribeToCollection(collectionName);
    }

    private subscribeToCollection(collectionName: string): void {
        // Clean up previous subscription if any.
        this.unsubscribe?.();

        const postsCollection = collection(this.db, collectionName);
        const q = query(postsCollection, orderBy('publishOn', 'desc'));
        this.postsLoading.set(true);

        this.unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const posts = snapshot.docs.map((doc) => ({
                    ...initCachedBlogPost(),
                    ...(doc.data() as CachedBlogPost),
                }));
                this.rawPosts.set(posts);
                this.postsLoading.set(false);
                this.subscribed.set(true);
            },
            (error) => {
                console.error(`Error subscribing to ${collectionName}:`, error);
                this.error.set('Failed to load blog posts. Please try again later.');
                this.postsLoading.set(false);
            },
        );
    }
}
