import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppUpdateService } from '../app-update.service';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-update-notification',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './update-notification.component.html',
  styleUrl: './update-notification.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateNotificationComponent {
  protected updateService = inject(AppUpdateService);

  onUpdate(): void {
    this.updateService.applyUpdate();
  }

  onDismiss(): void {
    this.updateService.dismissPrompt();
  }
}
