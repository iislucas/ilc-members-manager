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
import { MembershipType, CachedBlogPost, initCachedBlogPost } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';

export interface ProcessedBlogEntry extends CachedBlogPost {
    safeBody: SafeHtml;
    safeExcerpt: SafeHtml;
}

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

    categories = signal<string[]>([]);
    selectedCategory = signal<string>('All');
    fallbackContent = signal<SafeHtml | null>(null);
    error = signal<string | null>(null);

    // Raw posts from Firestore.
    private rawPosts = signal<CachedBlogPost[]>([]);
    private subscribed = signal(false);

    // Process cached posts into template-ready entries with sanitised HTML.
    readonly blogEntries = computed<ProcessedBlogEntry[]>(() => {
        if (!this.subscribed()) return [];
        return this.rawPosts().map((item) => ({
            ...item,
            safeBody: this.sanitizer.bypassSecurityTrustHtml(item.body),
            safeExcerpt: this.sanitizer.bypassSecurityTrustHtml(item.excerpt),
        }));
    });

    readonly loading = computed(() => {
        if (this.error()) return false;
        if (!this.subscribed()) return true;
        return this.postsLoading();
    });

    private postsLoading = signal(true);

    filteredEntries = computed(() => {
        const cat = this.selectedCategory();
        const entries = this.blogEntries();
        if (cat === 'All') return entries;
        return entries.filter(e => e.categories && e.categories.includes(cat));
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

        // Build the category list whenever blog entries change.
        effect(() => {
            const entries = this.blogEntries();
            if (entries.length > 0) {
                const allCategories = new Set<string>();
                entries.forEach(item => {
                    if (item.categories) {
                        item.categories.forEach((c: string) => allCategories.add(c));
                    }
                });
                this.categories.set(['All', ...Array.from(allCategories).sort()]);
            }
        });

        // Sync the selected category from the URL.
        effect(() => {
            const patternId = this.routingService.matchedPatternId();
            if (patternId === Views.MembersArea
                || patternId === Views.InstructorsArea
                || patternId === Views.MembersAreaCategory
                || patternId === Views.InstructorsAreaCategory) {
                let urlCat = '';
                if (patternId === Views.MembersArea) {
                    urlCat = 'All';
                } else if (patternId === Views.MembersAreaCategory) {
                    urlCat = this.routingService.signals[Views.MembersAreaCategory].pathVars.category();
                } else if (patternId === Views.InstructorsArea) {
                    urlCat = 'All';
                } else if (patternId === Views.InstructorsAreaCategory) {
                    urlCat = this.routingService.signals[Views.InstructorsAreaCategory].pathVars.category();
                }

                urlCat = decodeURIComponent(urlCat || 'All');

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
        const encodedCat = encodeURIComponent(cat);

        if (patternId === Views.MembersArea || patternId === Views.MembersAreaCategory) {
            this.routingService.navigateToParts(cat === 'All' ? ['members-area', 'category', 'All'] : ['members-area', 'category', encodedCat]);
        } else if (patternId === Views.InstructorsArea || patternId === Views.InstructorsAreaCategory) {
            this.routingService.navigateToParts(cat === 'All' ? ['instructors-area', 'category', 'All'] : ['instructors-area', 'category', encodedCat]);
        }
    }

    navigateToArticle(entry: ProcessedBlogEntry) {
        const collectionName = this.path();
        if (collectionName === 'members-post') {
            this.routingService.navigateTo('members-area/post/' + entry.urlId);
        } else if (collectionName === 'instructors-post') {
            this.routingService.navigateTo('instructors-area/post/' + entry.urlId);
        }
    }

    private isActiveMember(): boolean {
        const user = this.firebaseService.user();
        if (!user) return false;
        const member = user.member;

        const nonExpiringTypes: MembershipType[] = [
            MembershipType.Life,
        ];
        if (nonExpiringTypes.includes(member.membershipType)) {
            return true;
        }

        if (
            member.membershipType === MembershipType.Inactive ||
            member.membershipType === MembershipType.Deceased
        ) {
            return false;
        }

        if (!member.currentMembershipExpires) return false;
        return new Date(member.currentMembershipExpires) > new Date();
    }

    public checkAccessAndSubscribe(collectionName: string) {
        const user = this.firebaseService.user();

        if (!user) {
            this.error.set('You must be logged in to view this content.');
            return;
        }

        const isMemberArea = collectionName === 'members-post';
        const isInstructorArea = collectionName === 'instructors-post';

        if (isMemberArea) {
            if (!this.isActiveMember()) {
                if (!user.member.currentMembershipExpires || user.member.currentMembershipExpires && new Date(user.member.currentMembershipExpires) < new Date()) {
                    this.error.set('Your membership has expired. Please renew your membership to access this content.');
                } else {
                    this.error.set('You must be an active member to view this content.');
                }
                return;
            }
        } else if (isInstructorArea) {
            if (!user.member.instructorId) {
                this.error.set('You must be an instructor to view this content.');
                return;
            }
            if (user.member.instructorLicenseExpires && new Date(user.member.instructorLicenseExpires) < new Date()) {
                this.error.set('Your instructor license has expired. Please renew your instructor license to access this content.');
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
