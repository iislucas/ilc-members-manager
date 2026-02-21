import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportMembersComponent } from './import-members/import-members.component';
import { ImportSchoolsComponent } from './import-schools/import-schools.component';
import { ImportOrdersComponent } from './import-orders/import-orders.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirebaseStateService } from '../firebase-state.service';

type Tab = 'members' | 'schools' | 'orders' | 'backup';

@Component({
  selector: 'app-import-export',
  standalone: true,
  imports: [CommonModule, ImportMembersComponent, ImportSchoolsComponent, ImportOrdersComponent, SpinnerComponent],
  templateUrl: './import-export.html',
  styleUrl: './import-export.scss',
})
export class ImportExportComponent {
  public activeTab = signal<Tab>('members');
  private firebaseStateService = inject(FirebaseStateService);
  private functions = getFunctions(this.firebaseStateService.app);

  public isBackingUp = signal(false);
  public backupMessage = signal('');

  setActiveTab(tab: Tab) {
    this.activeTab.set(tab);
  }

  async triggerBackup() {
    this.isBackingUp.set(true);
    this.backupMessage.set('');

    try {
      const manualBackup = httpsCallable<unknown, { success: boolean, fileName: string }>(this.functions, 'manualBackup');
      const result = await manualBackup();
      this.backupMessage.set('Backup successful: ' + result.data.fileName);
    } catch (error) {
      console.error('Backup failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backupMessage.set('Backup failed: ' + errorMessage);
    } finally {
      this.isBackingUp.set(false);
    }
  }
}
