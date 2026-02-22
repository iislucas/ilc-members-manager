import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirebaseStateService } from '../firebase-state.service';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-class-video-library',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './class-video-library.html',
  styleUrl: './class-video-library.scss',
})
export class ClassVideoLibraryComponent {
  public firebaseService = inject(FirebaseStateService);
  public user = this.firebaseService.user;

  get todayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  openVideoLibrarySubscription() {
    window.open('https://iliqchuan.com/shop/monthly-class-video-library-subscription/', '_blank');
  }
}
