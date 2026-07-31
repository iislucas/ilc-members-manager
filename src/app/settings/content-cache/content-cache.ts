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

    async clearCache() {
        this.isClearing.set(true);
        this.resultMessage.set('');
        this.errorMessage.set('');

        try {
            const clearFn = httpsCallable<
                void,
                { success: boolean; deletedCount: number }
            >(this.functions, 'clearContentCache');

            const result = await clearFn();
            this.resultMessage.set(
                `Cache cleared: ${result.data.deletedCount} items deleted.`,
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
