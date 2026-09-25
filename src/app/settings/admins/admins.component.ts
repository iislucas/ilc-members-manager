import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { DataManagerService } from '../../data-manager.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { ACL } from '../../../../functions/src/data-model/system';

export interface AdminEntry {
  email: string;
  memberDocIds: string[];
  memberNames: string[];
}

@Component({
  selector: 'app-admins-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './admins.component.html',
  styleUrl: './admins.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminsSettingsComponent implements OnInit {
  public dataManager = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  private destroyRef = inject(DestroyRef);
  private db = getFirestore(this.firebaseState.app);

  adminsList = signal<{ email: string; memberDocIds: string[] }[]>([]);
  isLoading = signal(true);
  isProcessing = signal(false);
  statusMessage = signal('');
  errorMessage = signal('');

  newAdminEmail = signal('');

  // Confirmation state for revoking
  emailToRevoke = signal<string | null>(null);

  currentUserEmail = computed(() => {
    return (this.firebaseState.user()?.firebaseUser.email || '').toLowerCase().trim();
  });

  // Derived admin list enriched with linked member names from dataManager.members
  admins = computed<AdminEntry[]>(() => {
    return this.adminsList().map((admin) => {
      const names: string[] = [];
      for (const docId of admin.memberDocIds || []) {
        const member = this.dataManager.members.get(docId);
        if (member) {
          const idStr = member.memberId ? ` (${member.memberId})` : '';
          names.push(`${member.name || 'Unnamed'}${idStr}`);
        }
      }
      return {
        email: admin.email,
        memberDocIds: admin.memberDocIds || [],
        memberNames: names,
      };
    });
  });

  ngOnInit() {
    const aclQuery = query(
      collection(this.db, 'acl'),
      where('isAdmin', '==', true),
    );

    const unsubscribe = onSnapshot(
      aclQuery,
      (snapshot) => {
        const list = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as ACL;
            return {
              email: docSnap.id,
              memberDocIds: data.memberDocIds || [],
            };
          })
          .sort((a, b) => a.email.localeCompare(b.email));
        this.adminsList.set(list);
        this.isLoading.set(false);
      },
      (error) => {
        console.error('Error listening to admin ACLs:', error);
        this.errorMessage.set(`Failed to load administrators: ${error.message}`);
        this.isLoading.set(false);
      },
    );

    this.destroyRef.onDestroy(() => {
      unsubscribe();
    });
  }

  async addAdmin() {
    const email = this.newAdminEmail().trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.errorMessage.set('Please enter a valid email address.');
      return;
    }

    if (this.adminsList().some((a) => a.email.toLowerCase() === email)) {
      this.errorMessage.set(`${email} is already an administrator.`);
      return;
    }

    this.isProcessing.set(true);
    this.statusMessage.set('');
    this.errorMessage.set('');

    try {
      await this.dataManager.setAdminPrivilege(email, true);
      this.statusMessage.set(`Successfully granted administrator privileges to ${email}.`);
      this.newAdminEmail.set('');
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to grant admin privileges.');
    } finally {
      this.isProcessing.set(false);
    }
  }

  promptRevoke(email: string) {
    if (email.toLowerCase() === this.currentUserEmail()) {
      this.errorMessage.set('You cannot revoke your own administrator privileges.');
      return;
    }
    this.emailToRevoke.set(email);
  }

  cancelRevoke() {
    this.emailToRevoke.set(null);
  }

  async confirmRevoke() {
    const email = this.emailToRevoke();
    if (!email) return;

    this.isProcessing.set(true);
    this.statusMessage.set('');
    this.errorMessage.set('');

    try {
      await this.dataManager.setAdminPrivilege(email, false);
      this.statusMessage.set(`Successfully revoked administrator privileges from ${email}.`);
      this.emailToRevoke.set(null);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to revoke admin privileges.');
    } finally {
      this.isProcessing.set(false);
    }
  }
}
