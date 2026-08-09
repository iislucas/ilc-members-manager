import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './not-found.html',
  styleUrl: './not-found.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  public firebaseState = inject(FirebaseStateService);

  public isLoggedIn = computed(() => !!this.firebaseState.user());

  public currentPath = computed(() => {
    return window.location.pathname;
  });

  goHome() {
    this.routingService.navigateToParts(['']);
  }

  goFindInstructor() {
    this.routingService.navigateToParts(['find-an-instructor']);
  }

  goEvents() {
    this.routingService.navigateToParts(['events']);
  }

  goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      this.goHome();
    }
  }
}
