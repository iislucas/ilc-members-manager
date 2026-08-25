/* stripe-products.service.ts
 *
 * The Stripe catalogue, read from the cached copy at /system/stripe-products.
 *
 * That document is publicly readable, so prices are on screen for visitors who
 * have not signed in — which is the whole point of showing a price structure
 * before the sign-in wall.
 *
 * It is deliberately NOT part of DataManagerService. The catalogue runs to
 * ~85KB, and most sessions never open a purchase page: someone checking their
 * profile, an instructor managing students, an admin working through gradings.
 * Loading it for all of them to serve the few who buy something is waste. This
 * service is injected only by the pages that sell things, and Angular does not
 * construct a `providedIn: 'root'` service until something first injects it, so
 * the read happens when — and only when — one of those pages is opened. It then
 * stays for the rest of the session, so going back is instant.
 *
 * There is no fallback to a callable: nothing asks the server to enumerate the
 * Stripe catalogue on demand. If the document is missing, the pages say prices
 * are unavailable, an admin can repopulate it from Settings, and the scheduled
 * refresh does so on its own.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { Firestore, doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { FirebaseStateService } from './firebase-state.service';
import {
  CachedStripeProducts,
  StripeProduct,
} from '../../functions/src/stripe-types';

@Injectable({ providedIn: 'root' })
export class StripeProductsService {
  private firebaseService = inject(FirebaseStateService);
  private db: Firestore = getFirestore(this.firebaseService.app);

  private readonly catalogue = signal<StripeProduct[]>([]);
  private readonly isLoading = signal(true);
  private readonly loadError = signal<string | null>(null);

  /** Every product in the catalogue. Pages filter this to what they sell. */
  readonly products = computed(() => this.catalogue());
  readonly loading = computed(() => this.isLoading());
  readonly error = computed(() => this.loadError());

  /**
   * Goes on a public page, so it says what the reader can do about it. The
   * cause goes to the console for whoever is debugging.
   */
  private static readonly unavailable =
    'Prices are temporarily unavailable. Please try again shortly.';

  private readonly unsubscribe: () => void;

  constructor() {
    this.unsubscribe = onSnapshot(
      doc(this.db, 'system', 'stripe-products'),
      (docSnap) => {
        if (docSnap.exists()) {
          const cached = docSnap.data() as CachedStripeProducts;
          this.catalogue.set(cached.products || []);
          this.loadError.set(null);
        } else {
          console.warn('No cached Stripe catalogue at /system/stripe-products.');
          this.catalogue.set([]);
          this.loadError.set(StripeProductsService.unavailable);
        }
        this.isLoading.set(false);
      },
      (error) => {
        console.warn('Error fetching cached Stripe products:', error);
        this.loadError.set(StripeProductsService.unavailable);
        this.isLoading.set(false);
      },
    );
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }
}
