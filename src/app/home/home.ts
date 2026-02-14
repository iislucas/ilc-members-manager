import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent, IconName } from '../icons/icon.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  private routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);
  private firebaseService = inject(FirebaseStateService);
  protected user = this.firebaseService.user;

  protected Views = Views;

  navigateTo(view: Views) {
    this.routingService.matchedPatternId.set(view);
  }
}
