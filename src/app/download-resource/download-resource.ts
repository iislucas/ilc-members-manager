/* download-resource.ts
 *
 * Standalone page for downloading a resource file. This provides stable,
 * shareable URLs in the form:
 *   #/resources/{accessLevel}/{fileName}
 *
 * The page checks the user's authentication and access tier, then calls
 * the getResourceDownloadUrl Cloud Function to obtain a signed download
 * URL. It shows helpful error messages when access is denied (e.g.
 * expired membership or instructor license), including links to renew
 * the relevant subscription.
 *
 * Public resources can be downloaded without logging in. All other
 * tiers require the user to be authenticated with the appropriate
 * active subscription.
 */

import {
  Component,
  computed,
  inject,
  signal,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { LoginComponent } from '../login/login';
import { environment } from '../../environments/environment';
import {
  ResourceAccessLevel,
  RESOURCE_ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
} from '../../../functions/src/data-model';

// Structured error info parsed from the Cloud Function's error details.
interface AccessError {
  title: string;
  message: string;
  // If set, the user can renew/fix their access at this URL.
  renewalUrl?: string;
  renewalLabel?: string;
}

// Represents the current state of the download flow.
type DownloadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'login-required' }
  | { kind: 'downloading' }
  | { kind: 'done'; fileName: string }
  | { kind: 'error'; error: AccessError };

@Component({
  selector: 'app-download-resource',
  standalone: true,
  imports: [SpinnerComponent, IconComponent, LoginComponent],
  templateUrl: './download-resource.html',
  styleUrl: './download-resource.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadResourceComponent {
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  private firebaseService = inject(FirebaseStateService);
  private dataManager = inject(DataManagerService);

  private viewSignals = this.routingService.signals[Views.DownloadResource];

  accessLevel = computed(() => {
    const raw = this.viewSignals.pathVars.accessLevel();
    if (RESOURCE_ACCESS_LEVELS.includes(raw as ResourceAccessLevel)) {
      return raw as ResourceAccessLevel;
    }
    return null;
  });

  fileName = computed(() => this.viewSignals.pathVars.fileName());

  // The full storage path used by the Cloud Function.
  fullPath = computed(() => {
    const level = this.accessLevel();
    const name = this.fileName();
    if (!level || !name) return '';
    return `resources/${level}/${name}`;
  });

  // Human-readable label for the access tier.
  accessLabel = computed(() => {
    const level = this.accessLevel();
    return level ? ACCESS_LEVEL_LABELS[level] : 'Unknown';
  });

  state = signal<DownloadState>({ kind: 'idle' });

  // Expose login status for the template.
  loginStatus = this.firebaseService.loginStatus;
  LoginStatus = LoginStatus;

  constructor() {
    // Automatically trigger the download flow when the page loads, user logs in,
    // or path variables change.
    effect(() => {
      const path = this.fullPath();
      const level = this.accessLevel();
      const login = this.firebaseService.loginStatus();

      // Wait until firebase has finished initialising.
      if (login === LoginStatus.FirebaseLoadingStatus) return;
      if (login === LoginStatus.LoggingIn) return;

      if (!path || !level) {
        this.state.set({
          kind: 'error',
          error: { title: 'Invalid Link', message: 'This resource link is not valid.' },
        });
        return;
      }

      // Public resources: download immediately, no login needed.
      if (level === ResourceAccessLevel.Public) {
        this.startDownload(path);
        return;
      }

      // Non-public: need to be logged in.
      if (login === LoginStatus.SignedOut) {
        this.state.set({ kind: 'login-required' });
        return;
      }

      // Signed in — attempt the download.
      if (login === LoginStatus.SignedIn) {
        this.startDownload(path);
      }
    });
  }

  async startDownload(fullPath: string) {
    // Prevent re-entry if already downloading or done.
    const current = this.state();
    if (current.kind === 'downloading' || current.kind === 'done') return;

    this.state.set({ kind: 'downloading' });
    try {
      const url = await this.dataManager.getResourceDownloadUrl(fullPath);
      this.state.set({ kind: 'done', fileName: this.fileName() });
      // Open in a new tab to trigger the browser's download.
      window.open(url, '_blank');
    } catch (err: unknown) {
      const error = this.parseAccessError(err);
      this.state.set({ kind: 'error', error });
    }
  }

  // Retry the download (e.g. after an error or after logging in).
  retry() {
    this.state.set({ kind: 'idle' });
    const path = this.fullPath();
    if (path) {
      this.startDownload(path);
    }
  }

  // Parses a Firebase callable error into a user-friendly AccessError with
  // appropriate renewal links based on the structured `details` object
  // returned by the Cloud Function.
  private parseAccessError(err: unknown): AccessError {
    // Firebase callable errors have .code, .message, and .details.
    const firebaseErr = err as {
      code?: string;
      message?: string;
      details?: {
        reason?: string;
        tier?: string;
        expiryDate?: string;
      };
    };

    const code = firebaseErr.code || '';
    const details = firebaseErr.details;
    const serverMessage = firebaseErr.message || 'An unknown error occurred.';

    // Not-found: could be a genuinely missing file or an admin-only resource
    // being accessed by a non-admin (Cloud Function masks admin resources as not-found).
    if (code === 'functions/not-found' || code === 'not-found') {
      return {
        title: 'Resource Not Found',
        message: 'This resource could not be found. The link may be outdated, or you may not have access.',
      };
    }

    // Permission denied with structured details from assertResourceAccess.
    if (details?.tier) {
      switch (details.tier) {
        case 'membership':
          return details.reason === 'expired'
            ? {
                title: 'Membership Expired',
                message: `Your membership expired on ${details.expiryDate}. Please renew it to access this resource.`,
                renewalUrl: environment.links.membership,
                renewalLabel: 'Renew Membership',
              }
            : {
                title: 'Members Only',
                message: 'This resource is for active members. You do not currently have an active membership.',
                renewalUrl: environment.links.membership,
                renewalLabel: 'Get Membership',
              };

        case 'instructor':
          return details.reason === 'expired'
            ? {
                title: 'Instructor License Expired',
                message: `Your instructor license expired on ${details.expiryDate}. Please renew it to access this resource.`,
                renewalUrl: environment.links.license,
                renewalLabel: 'Renew License',
              }
            : {
                title: 'Instructors Only',
                message: 'This resource is for licensed instructors. You do not currently have an instructor license.',
                renewalUrl: environment.links.license,
                renewalLabel: 'Get Instructor License',
              };

        case 'school':
          return details.reason === 'expired'
            ? {
                title: 'School License Expired',
                message: `Your school license expired on ${details.expiryDate}. Please renew it to access this resource.`,
                renewalUrl: environment.links.license,
                renewalLabel: 'Renew License',
              }
            : {
                title: 'School Owners Only',
                message: 'This resource is for school owners and managers. You do not currently have an active school license.',
                renewalUrl: environment.links.license,
                renewalLabel: 'Get School License',
              };
      }
    }

    // Fallback: use the raw server message.
    return { title: 'Access Denied', message: serverMessage };
  }
}
