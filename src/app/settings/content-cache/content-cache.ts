import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    doc,
    onSnapshot,
    getFirestore,
    Unsubscribe,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FIREBASE_APP } from '../../app.config';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { CacheMetadata, initCacheMetadata } from '../../../../functions/src/data-model';

@Component({
    selector: 'app-content-cache',
    standalone: true,
    imports: [CommonModule, SpinnerComponent],
    templateUrl: './content-cache.html',
    styleUrl: './content-cache.scss',
})
export class ContentCacheComponent implements OnInit, OnDestroy {
    private firebaseApp = inject(FIREBASE_APP);
    private db = getFirestore(this.firebaseApp);
    private functions = getFunctions(this.firebaseApp);
    private unsubscribe: Unsubscribe | null = null;

    metadata = signal<CacheMetadata>(initCacheMetadata());
    metadataLoading = signal(true);

    isRefreshing = signal(false);
    isRefreshingStripe = signal(false);
    isClearing = signal(false);
    resultMessage = signal('');
    errorMessage = signal('');

    ngOnInit() {
        this.subscribeToMetadata();
    }

    ngOnDestroy() {
        this.unsubscribe?.();
    }

    private subscribeToMetadata(): void {
        const metaRef = doc(this.db, 'system', 'cache-metadata');
        this.metadataLoading.set(true);

        this.unsubscribe = onSnapshot(
            metaRef,
            (snapshot) => {
                if (snapshot.exists()) {
                    this.metadata.set({
                        ...initCacheMetadata(),
                        ...(snapshot.data() as Partial<CacheMetadata>),
                    });
                }
                this.metadataLoading.set(false);
            },
            (error) => {
                console.error('Error subscribing to cache metadata:', error);
                this.errorMessage.set('Failed to load cache metadata.');
                this.metadataLoading.set(false);
            },
        );
    }

    async refreshBlogs() {
        this.isRefreshing.set(true);
        this.resultMessage.set('');
        this.errorMessage.set('');

        try {
            const refreshFn = httpsCallable<
                void,
                {
                    success: boolean;
                    postCount: number;
                    blogsUpdated?: number;
                    blogsRemoved?: number;
                }
            >(this.functions, 'manualRefreshCache');

            const result = await refreshFn();

            if (result.data.postCount > 0) {
                const detail = result.data.blogsUpdated !== undefined
                    ? ` (${result.data.blogsUpdated} updated, ${result.data.blogsRemoved} removed)`
                    : '';
                this.resultMessage.set(
                    `Cache synced: ${result.data.postCount} blog posts${detail}.`,
                );
            } else {
                this.resultMessage.set('Cache synced (no items found).');
            }
        } catch (error) {
            console.error('Cache refresh failed:', error);
            const msg = error instanceof Error ? error.message : String(error);
            this.errorMessage.set(`Cache refresh failed: ${msg}`);
        } finally {
            this.isRefreshing.set(false);
        }
    }

    async refreshStripeProducts() {
        this.isRefreshingStripe.set(true);
        this.resultMessage.set('');
        this.errorMessage.set('');

        try {
            const refreshFn = httpsCallable<
                void,
                { success: boolean; productCount: number; lastRefreshed: string }
            >(this.functions, 'manualRefreshStripeProducts');

            const result = await refreshFn();
            this.resultMessage.set(
                `Stripe catalogue synced: ${result.data.productCount} products.`,
            );
        } catch (error) {
            console.error('Stripe catalogue refresh failed:', error);
            const msg = error instanceof Error ? error.message : String(error);
            this.errorMessage.set(`Stripe catalogue refresh failed: ${msg}`);
        } finally {
            this.isRefreshingStripe.set(false);
        }
    }

    async clearCache() {
        this.isClearing.set(true);
        this.resultMessage.set('');
        this.errorMessage.set('');

        try {
            const clearFn = httpsCallable<
                void,
                { success: boolean; deletedCount: number; keptCount: number }
            >(this.functions, 'clearContentCache');

            const result = await clearFn();
            // Only Squarespace-sourced posts are cache; any posts authored in
            // the app are kept, so report both numbers.
            const { deletedCount, keptCount } = result.data;
            this.resultMessage.set(
                `Cache cleared: ${deletedCount} cached items deleted.` +
                (keptCount
                    ? ` ${keptCount} authored item(s) kept.`
                    : ''),
            );
        } catch (error) {
            console.error('Cache clear failed:', error);
            const msg = error instanceof Error ? error.message : String(error);
            this.errorMessage.set(`Cache clear failed: ${msg}`);
        } finally {
            this.isClearing.set(false);
        }
    }

    formatDate(iso: string): string {
        if (!iso) return 'Never';
        try {
            return new Date(iso).toLocaleString();
        } catch {
            return iso;
        }
    }
}
