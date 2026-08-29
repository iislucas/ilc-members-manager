import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppUpdateService } from '../../app-update.service';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';

@Component({
  selector: 'app-version-settings',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './app-version.html',
  styleUrl: './app-version.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppVersionSettingsComponent {
  protected updateService = inject(AppUpdateService);

  formattedBuildDate = computed(() => {
    const ver = this.updateService.currentVersion();
    const plusIdx = ver.indexOf('+');
    if (plusIdx === -1) return 'Development Build';
    const timestamp = ver.substring(plusIdx + 1);
    try {
      const d = new Date(timestamp + ':00Z');
      return isNaN(d.getTime()) ? timestamp : d.toUTCString();
    } catch {
      return timestamp;
    }
  });

  formattedLastChecked = computed(() => {
    const last = this.updateService.lastChecked();
    if (!last) return 'Not checked yet this session';
    return `${last.toLocaleDateString()} ${last.toLocaleTimeString()}`;
  });

  async onCheckForUpdates(): Promise<void> {
    await this.updateService.checkForUpdate();
  }

  async onApplyUpdate(): Promise<void> {
    await this.updateService.applyUpdate();
  }
}
