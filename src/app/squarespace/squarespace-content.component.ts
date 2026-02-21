import { Component, effect, inject, input, ViewEncapsulation, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SquarespaceService } from './squarespace.service';
import { FirebaseStateService } from '../firebase-state.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MembershipType } from '../../../functions/src/data-model';

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
    content = signal<SafeHtml | null>(null);
    loading = signal<boolean>(true);
    error = signal<string | null>(null);

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
            next: (data: any) => {
                console.group('Squarespace Content Details');
                console.log('Full response object:', data);
                if (data && typeof data === 'object') {
                    console.log('Available keys:', Object.keys(data));
                    if (data.collection) console.log('Collection data:', data.collection);
                    if (data.items) console.log('Items data (length):', data.items.length, data.items);
                    if (data.mainContent) console.log('Main Content (length):', data.mainContent.length);
                }
                console.groupEnd();

                let htmlContent = '';
                let baseUrl = '';

                if (data) {
                    // Try to extract base URL for link fixing
                    baseUrl = data.website?.baseUrl || '';
                    if (baseUrl && !baseUrl.startsWith('http')) {
                        baseUrl = 'https:' + (baseUrl.startsWith('//') ? '' : '//') + baseUrl;
                    }

                    // 1. Try mainContent (standard for Pages)
                    if (data.mainContent) {
                        htmlContent = data.mainContent;
                    }
                    // 2. Try items (standard for Blogs, Events, etc.)
                    else if (data.items && Array.isArray(data.items)) {
                        htmlContent = data.items
                            .map((item: any) => {
                                const title = item.title ? `<h2 class="sqs-title">${item.title}</h2>` : '';
                                const image = item.assetUrl ? `<img class="sqs-image" src="${item.assetUrl}" alt="${item.title || ''}" />` : '';
                                const body = item.body || item.content || '';
                                return `<article class="sqs-item">\n${title}\n${image}\n${body}\n</article>`;
                            })
                            .join('<hr class="sqs-separator">');
                    }
                    // 3. Try collection description as fallback
                    else if (data.collection?.description) {
                        htmlContent = data.collection.description;
                    }
                    // 4. If data is just a string, it might be the HTML directly
                    else if (typeof data === 'string') {
                        htmlContent = data;
                    }
                    // 5. Check for sections (common in 7.1)
                    else if (data.sections && Array.isArray(data.sections)) {
                        htmlContent = data.sections
                            .map((s: any) => s.html || '')
                            .join('');
                    }
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
                this.content.set(this.sanitizer.bypassSecurityTrustHtml(processedHtml));
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
