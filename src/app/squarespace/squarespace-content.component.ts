import { Component, effect, inject, input, ViewEncapsulation, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SquarespaceService } from './squarespace.service';
import { FirebaseStateService } from '../firebase-state.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MembershipType } from '../../../functions/src/data-model';
import { SquareSpaceBlogsResponse, SquareSpaceBlogEntry } from './blog-types';

export interface ProcessedBlogEntry extends SquareSpaceBlogEntry {
    safeBody: SafeHtml;
    safeExcerpt: SafeHtml;
}

@Component({
    selector: 'app-squarespace-content',
    standalone: true,
    imports: [CommonModule, SpinnerComponent],
    templateUrl: './squarespace-content.component.html',
    styleUrls: ['./squarespace-content.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class SquarespaceContentComponent {
    private squarespaceService = inject(SquarespaceService);
    private sanitizer = inject(DomSanitizer);
    public firebaseService = inject(FirebaseStateService);

    /** The Squarespace path to fetch, e.g. '/members-area' */
    path = input.required<string>();

    blogEntries = signal<ProcessedBlogEntry[]>([]);
    categories = signal<string[]>([]);
    selectedCategory = signal<string>('All');
    fallbackContent = signal<SafeHtml | null>(null);
    expandedIds = signal<Set<string>>(new Set<string>());

    loading = signal<boolean>(true);
    error = signal<string | null>(null);

    filteredEntries = computed(() => {
        const cat = this.selectedCategory();
        const entries = this.blogEntries();
        if (cat === 'All') return entries;
        return entries.filter(e => e.categories && e.categories.includes(cat));
    });

    constructor() {
        effect(() => {
            const path = this.path();
            if (path) {
                this.checkAccessAndLoad(path);
            } else {
                this.error.set('Configuration error: No path specified.');
                this.loading.set(false);
            }
        });
    }

    toggleExpanded(id: string) {
        const current = new Set(this.expandedIds());
        if (current.has(id)) {
            current.delete(id);
        } else {
            current.add(id);
        }
        this.expandedIds.set(current);
    }

    isExpanded(id: string): boolean {
        return this.expandedIds().has(id);
    }

    private isActiveMember(): boolean {
        const user = this.firebaseService.user();
        if (!user) return false;
        const member = user.member;

        // Life, LifePartner, Senior memberships don't expire
        const nonExpiringTypes: MembershipType[] = [
            MembershipType.Life,
            MembershipType.LifePartner,
        ];
        if (nonExpiringTypes.includes(member.membershipType)) {
            return true;
        }

        // Inactive / Deceased are never active
        if (
            member.membershipType === MembershipType.Inactive ||
            member.membershipType === MembershipType.Deceased
        ) {
            return false;
        }

        // For all other types, check the expiration date
        if (!member.currentMembershipExpires) return false;
        return new Date(member.currentMembershipExpires) > new Date();
    }

    public checkAccessAndLoad(path: string) {
        const user = this.firebaseService.user();

        if (!user) {
            this.error.set('You must be logged in to view this content.');
            this.loading.set(false);
            return;
        }

        // Role-based access check
        const isMemberArea = path.includes('member');
        const isInstructorArea = path.includes('instructor');

        if (isMemberArea) {
            if (!this.isActiveMember()) {
                if (!user.member.currentMembershipExpires || user.member.currentMembershipExpires && new Date(user.member.currentMembershipExpires) < new Date()) {
                    this.error.set('Your membership has expired. Please renew your membership to access this content.');
                } else {
                    this.error.set('You must be an active member to view this content.');
                }
                this.loading.set(false);
                return;
            }
        } else if (isInstructorArea) {
            if (!user.member.instructorId) {
                this.error.set('You must be an instructor to view this content.');
                this.loading.set(false);
                return;
            }
            if (user.member.instructorLicenseExpires && new Date(user.member.instructorLicenseExpires) < new Date()) {
                this.error.set('Your instructor license has expired. Please renew your instructor license to access this content.');
                this.loading.set(false);
                return;
            }
        }

        this.loadContent(path);
    }

    private loadContent(path: string) {
        this.loading.set(true);
        this.error.set(null);

        this.squarespaceService.getSquarespaceContent(path).subscribe({
            next: (data: SquareSpaceBlogsResponse) => {
                console.log('Squarespace content loaded:', data);

                let htmlContent = '';
                let baseUrl = '';

                if (data) {
                    // Try to extract base URL for link fixing
                    baseUrl = data.website?.baseUrl || '';
                    if (baseUrl && !baseUrl.startsWith('http')) {
                        baseUrl = 'https:' + (baseUrl.startsWith('//') ? '' : '//') + baseUrl;
                    }

                    if (data.items && Array.isArray(data.items)) {
                        const processed: ProcessedBlogEntry[] = data.items.map((item: any) => {
                            let assetUrl = item.assetUrl ? String(item.assetUrl).trim() : '';

                            // Squarespace placeholder URLs often end with a slash without an actual image filename, 
                            // which then redirects to 'no-image.png'.
                            if (assetUrl === "undefined" || assetUrl === "null" || assetUrl.includes('no-image.png') || assetUrl.endsWith('/')) {
                                assetUrl = '';
                            }

                            if (assetUrl && !assetUrl.startsWith('http') && !assetUrl.startsWith('//')) {
                                assetUrl = baseUrl + (assetUrl.startsWith('/') ? '' : '/') + assetUrl;
                            }

                            return {
                                ...item,
                                assetUrl,
                                safeBody: this.sanitizer.bypassSecurityTrustHtml(this.processHtml(item.body || item.content || '', baseUrl)),
                                safeExcerpt: this.sanitizer.bypassSecurityTrustHtml(this.processHtml(item.excerpt || '', baseUrl)),
                            };
                        });

                        this.blogEntries.set(processed);

                        const allCategories = new Set<string>();
                        processed.forEach(item => {
                            if (item.categories) {
                                item.categories.forEach((c: string) => allCategories.add(c));
                            }
                        });
                        this.categories.set(['All', ...Array.from(allCategories).sort()]);
                        this.fallbackContent.set(null);
                        this.loading.set(false);
                        return;
                    }

                    let htmlContent = '';
                    if (data.collection?.description) {
                        htmlContent = data.collection.description;
                    } else if (typeof data === 'string') {
                        htmlContent = data;
                    } else if (data.sections && Array.isArray(data.sections)) {
                        htmlContent = data.sections.map((s: any) => s.html || '').join('');
                    }

                    if (!htmlContent || htmlContent.trim() === '') {
                        console.warn('No content found in Squarespace response', data);
                        const title = data?.collection?.title || 'this page';
                        htmlContent = `<div class="empty-content-warning">
                            <p>No content was found for <strong>${title}</strong>.</p>
                            <p>This may be because the page is empty or requires direct login.</p>
                        </div>`;
                    }

                    // Process the HTML to ensure it works outside Squarespace
                    const processedHtml = this.processHtml(htmlContent, baseUrl);
                    this.fallbackContent.set(this.sanitizer.bypassSecurityTrustHtml(processedHtml));
                    this.blogEntries.set([]);
                }
                this.loading.set(false);
            },
            error: (err) => {
                console.error('Error loading content', err);
                this.error.set('Failed to load content from Squarespace. Please check your connection or try again later.');
                this.loading.set(false);
            },
        });
    }

    private processHtml(html: string, baseUrl: string): string {
        if (!html) return '';

        // 1. Fix protocol-relative URLs (//images.squarespace-cdn.com -> https://images.squarespace-cdn.com)
        let processed = html.replace(/src="\/\//g, 'src="https://');
        processed = processed.replace(/href="\/\//g, 'href="https://');

        // 2. Fix relative URLs if we have a baseUrl
        if (baseUrl) {
            const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
            // Match src="/..." or href="/..." but not src="//..." or href="//..."
            // Using a negative lookahead to avoid matching protocol-relative URLs
            processed = processed.replace(/(src|href)="\/([^/])/g, `$1="${base}/$2`);
        }

        // 3. Fix Squarespace lazy-loaded images
        // Squarespace images often use data-src and no src, and require their JS to load.
        // We force them to load by swapping data-src to src.
        processed = processed.replace(/data-src=/g, 'src=');

        // Remove 'loading' class that might hide images via Squarespace's default CSS
        processed = processed.replace(/class="loading"/g, 'class=""');

        // 4. Ensure images don't have broken srcset/sizes if we're not using their JS
        processed = processed.replace(/data-srcset=/g, 'srcset=');

        return processed;
    }
}
