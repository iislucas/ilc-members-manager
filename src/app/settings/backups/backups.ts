import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../../data-manager.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { SpinnerComponent } from '../../spinner/spinner.component';

@Component({
  selector: 'app-backups',
  standalone: true,
  imports: [CommonModule, SpinnerComponent],
  templateUrl: './backups.html',
  styleUrl: './backups.scss',
})
export class Backups implements OnInit {
  dataManager = inject(DataManagerService);
  private firebaseStateService = inject(FirebaseStateService);
  private functions = getFunctions(this.firebaseStateService.app);

  backups = signal<any[]>([]);
  isLoadingBackups = signal(false);
  backupsMessage = signal('');

  public isBackingUp = signal(false);
  public backupTriggerMessage = signal('');

  ngOnInit() {
    this.loadBackups();
  }

  async loadBackups() {
    this.isLoadingBackups.set(true);
    this.backupsMessage.set('');
    try {
      const list = await this.dataManager.listBackups();
      this.backups.set(list);
    } catch (err: any) {
      this.backupsMessage.set(`Error loading backups: ${err.message}`);
    } finally {
      this.isLoadingBackups.set(false);
    }
  }

  async triggerBackup() {
    this.isBackingUp.set(true);
    this.backupTriggerMessage.set('');

    try {
      const manualBackup = httpsCallable<unknown, { success: boolean, fileName: string }>(this.functions, 'manualBackup');
      const result = await manualBackup();
      this.backupTriggerMessage.set('Backup successful: ' + result.data.fileName);
      this.loadBackups(); // Refresh the list after successful backup
    } catch (error) {
      console.error('Backup failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backupTriggerMessage.set('Backup failed: ' + errorMessage);
    } finally {
      this.isBackingUp.set(false);
    }
  }
}
