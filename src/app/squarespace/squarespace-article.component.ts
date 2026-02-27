import { Component, effect, inject, input, ViewEncapsulation, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SquarespaceService } from './squarespace.service';
import { FirebaseStateService } from '../firebase-state.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MembershipType } from '../../../functions/src/data-model';
import { ProcessedBlogEntry } from './squarespace-content.component';

@Component({
    selector: 'app-squarespace-article',
    standalone: true,
    imports: [CommonModule, SpinnerComponent],
    templateUrl: './squarespace-article.component.html',
    styleUrls: ['./squarespace-content.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class SquarespaceArticleComponent {
    private squarespaceService = inject(SquarespaceService);
    private sanitizer = inject(DomSanitizer);
    public firebaseService = inject(FirebaseStateService);

    collection = input.required<string>();
    articleId = input.required<string>();

    entry = signal<ProcessedBlogEntry | null>(null);

    loading = signal<boolean>(true);
    error = signal<string | null>(null);

    constructor() {
        effect(() => {
            const collection = this.collection();
            const articleId = this.articleId();
            if (collection && articleId) {
                this.checkAccessAndLoad(collection, articleId);
            } else {
                this.error.set('Configuration error: No article specified.');
                this.loading.set(false);
            }
        });
    }

    private isActiveMember(): boolean {
        const user = this.firebaseService.user();
        if (!user) return false;
        const member = user.member;

        const nonExpiringTypes: MembershipType[] = [
            MembershipType.Life,
            MembershipType.LifePartner,
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

    public checkAccessAndLoad(collection: string, articleId: string) {
        const user = this.firebaseService.user();

        if (!user) {
            this.error.set('You must be logged in to view this content.');
            this.loading.set(false);
            return;
        }

        const isMemberArea = collection.includes('member');
        const isInstructorArea = collection.includes('instructor');

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

        this.loadContent(`${collection}/${articleId}`);
    }

    private loadContent(fullPath: string) {
        this.loading.set(true);
        this.error.set(null);

        this.squarespaceService.getSquarespaceContent(fullPath).subscribe({
            next: (data: any) => {
                console.log('Squarespace article loaded:', data);

                let baseUrl = '';

                if (data && data.item) {
                    baseUrl = data.website?.baseUrl || '';
                    if (baseUrl && !baseUrl.startsWith('http')) {
                        baseUrl = 'https:' + (baseUrl.startsWith('//') ? '' : '//') + baseUrl;
                    }

                    const item = data.item;
                    let assetUrl = item.assetUrl ? String(item.assetUrl).trim() : '';

                    if (assetUrl === "undefined" || assetUrl === "null" || assetUrl.includes('no-image.png') || assetUrl.endsWith('/')) {
                        assetUrl = '';
                    }

                    if (assetUrl && !assetUrl.startsWith('http') && !assetUrl.startsWith('//')) {
                        assetUrl = baseUrl + (assetUrl.startsWith('/') ? '' : '/') + assetUrl;
                    }

                    const processed: ProcessedBlogEntry = {
                        ...item,
                        assetUrl,
                        safeBody: this.sanitizer.bypassSecurityTrustHtml(this.processHtml(item.body || item.content || '', baseUrl)),
                        safeExcerpt: this.sanitizer.bypassSecurityTrustHtml(this.processHtml(item.excerpt || '', baseUrl)),
                    };

                    this.entry.set(processed);
                    this.loading.set(false);
                    return;
                }

                this.error.set('Failed to load article content.');
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

        let processed = html.replace(/src="\/\//g, 'src="https://');
        processed = processed.replace(/href="\/\//g, 'href="https://');

        if (baseUrl) {
            const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
            processed = processed.replace(/(src|href)="\/([^/])/g, `$1="${base}/$2`);
        }

        processed = processed.replace(/<img([^>]*)>/gi, (match) => {
            let newImg = match;

            if (newImg.includes('data-src=')) {
                const dataSrcMatch = newImg.match(/data-src="([^"]+)"/);
                if (dataSrcMatch) {
                    let realSrc = dataSrcMatch[1];
                    if (!realSrc.includes('format=')) {
                        realSrc += (realSrc.includes('?') ? '&' : '?') + 'format=1000w';
                    }
                    newImg = newImg.replace(/\s+src="[^"]*"/g, '');
                    newImg = newImg.replace(/data-src="[^"]*"/, `src="${realSrc}"`);
                }
            }

            if (newImg.includes('data-srcset=')) {
                newImg = newImg.replace(/\s+srcset="[^"]*"/g, '');
                newImg = newImg.replace(/data-srcset=/g, 'srcset=');
            }

            newImg = newImg.replace(/class="([^"]*)loading([^"]*)"/gi, 'class="$1$2"');

            return newImg;
        });

        processed = processed.replace(
            /<div[^>]*class="[^"]*sqs-video-wrapper[^"]*"[^>]*data-html="([^"]+)"[^>]*>.*?<\/div>/gi,
            (_match, dataHtml) => {
                const unescaped = dataHtml
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&');
                return `<div class="ilc-video-container">${unescaped}</div>`;
            }
        );

        return processed;
    }
}
