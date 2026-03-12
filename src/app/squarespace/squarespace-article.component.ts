import { Component, effect, inject, input, ViewEncapsulation, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
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
import { MembershipType, CachedBlogPost, initCachedBlogPost } from '../../../functions/src/data-model';
import { ProcessedBlogEntry } from './squarespace-content.component';

@Component({
    selector: 'app-squarespace-article',
    standalone: true,
    imports: [CommonModule, SpinnerComponent],
    templateUrl: './squarespace-article.component.html',
    styleUrls: ['./squarespace-content.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class SquarespaceArticleComponent implements OnDestroy {
    private sanitizer = inject(DomSanitizer);
    public firebaseService = inject(FirebaseStateService);
    private firebaseApp = inject(FIREBASE_APP);
    private db = getFirestore(this.firebaseApp);
    private unsubscribe: Unsubscribe | null = null;

    // The Firestore collection name, e.g. 'members-post' or 'instructors-post'.
    collection = input.required<string>();
    blogPostPath = input.required<string>();

    error = signal<string | null>(null);

    // Raw posts from Firestore.
    private rawPosts = signal<CachedBlogPost[]>([]);
    private subscribed = signal(false);
    private postsLoading = signal(true);

    // Find the matching post and process it into a template-ready entry.
    readonly entry = computed<ProcessedBlogEntry | null>(() => {
        const posts = this.rawPosts();
        const slug = this.blogPostPath();
        if (!slug || posts.length === 0) return null;

        const matchingPost = posts.find(p => p.urlId === slug);
        if (!matchingPost) return null;

        return {
            ...matchingPost,
            safeBody: this.sanitizer.bypassSecurityTrustHtml(matchingPost.body),
            safeExcerpt: this.sanitizer.bypassSecurityTrustHtml(matchingPost.excerpt),
        };
    });

    readonly loading = computed(() => {
        if (this.error()) return false;
        if (!this.subscribed()) return true;
        return this.postsLoading();
    });

    constructor() {
        effect(() => {
            const collectionName = this.collection();
            const blogPostPath = this.blogPostPath();
            if (collectionName && blogPostPath) {
                this.checkAccessAndSubscribe(collectionName);
            } else {
                this.error.set('Configuration error: No article specified.');
            }
        });

        // When posts are loaded but the article isn't found, set an error.
        effect(() => {
            if (!this.subscribed()) return;
            if (this.postsLoading()) return;
            const e = this.entry();
            const posts = this.rawPosts();
            if (!e && posts.length > 0) {
                this.error.set('Article not found.');
            }
        });
    }

    ngOnDestroy(): void {
        this.unsubscribe?.();
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
                this.error.set('Failed to load article. Please try again later.');
                this.postsLoading.set(false);
            },
        );
    }
}
