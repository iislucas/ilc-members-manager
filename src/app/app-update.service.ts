import {
  ApplicationRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { SwUpdate, VersionEvent, VersionReadyEvent } from '@angular/service-worker';
import { concat, interval } from 'rxjs';
import { first } from 'rxjs/operators';
import { APP_VERSION } from './version';

@Injectable({
  providedIn: 'root',
})
export class AppUpdateService {
  private swUpdate = inject(SwUpdate, { optional: true });
  private appRef = inject(ApplicationRef);

  readonly isUpdateAvailable = signal<boolean>(false);
  readonly isChecking = signal<boolean>(false);
  readonly checkError = signal<string | null>(null);
  readonly lastChecked = signal<Date | null>(null);
  readonly currentVersion = signal<string>(APP_VERSION);
  readonly latestVersion = signal<string | null>(null);
  readonly updateDismissed = signal<boolean>(false);
  readonly isServiceWorkerEnabled = signal<boolean>(this.swUpdate?.isEnabled ?? false);

  constructor() {
    if (!this.swUpdate || !this.swUpdate.isEnabled) {
      return;
    }

    // Listen for version update events from the service worker.
    this.swUpdate.versionUpdates.subscribe((event: VersionEvent) => {
      switch (event.type) {
        case 'VERSION_DETECTED':
          break;
        case 'VERSION_READY': {
          const readyEvent = event as VersionReadyEvent;
          this.isUpdateAvailable.set(true);
          this.latestVersion.set(readyEvent.latestVersion.hash);
          this.updateDismissed.set(false);
          break;
        }
        case 'VERSION_INSTALLATION_FAILED':
          this.checkError.set(`Failed to install update: ${event.error}`);
          break;
        case 'NO_NEW_VERSION_DETECTED':
          break;
      }
    });

    // Schedule periodic checks once the application is stable (every 60 mins).
    const appIsStable$ = this.appRef.isStable.pipe(first((isStable) => isStable));
    const everyHour$ = interval(60 * 60 * 1000);
    const periodicChecks$ = concat(appIsStable$, everyHour$);

    periodicChecks$.subscribe(() => {
      this.checkForUpdate();
    });

    // Check when user switches back to the app tab
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.checkForUpdate();
        }
      });
    }
  }

  async checkForUpdate(): Promise<boolean> {
    if (!this.swUpdate || !this.swUpdate.isEnabled) {
      this.isChecking.set(false);
      this.lastChecked.set(new Date());
      return false;
    }

    this.isChecking.set(true);
    this.checkError.set(null);
    try {
      const updateFound = await this.swUpdate.checkForUpdate();
      this.lastChecked.set(new Date());
      return updateFound;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.checkError.set(msg);
      return false;
    } finally {
      this.isChecking.set(false);
    }
  }

  async applyUpdate(): Promise<void> {
    if (!this.swUpdate || !this.swUpdate.isEnabled) {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
      return;
    }

    try {
      await this.swUpdate.activateUpdate();
      if (typeof document !== 'undefined') {
        document.location.reload();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.checkError.set(msg);
      // Fallback reload
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  }

  dismissPrompt(): void {
    this.updateDismissed.set(true);
  }
}
