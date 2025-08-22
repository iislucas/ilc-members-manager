import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirebaseStateService } from '../firebase-state.service';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-profile-menu',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './profile-menu.html',
  styleUrls: ['./profile-menu.scss'],
})
export class ProfileMenuComponent {
  public firebaseService = inject(FirebaseStateService);
  public user = this.firebaseService.user;
  public menuOpen = signal(false);

  get userInitial(): string {
    const user = this.user();
    if (user && user.displayName) {
      return user.displayName.charAt(0).toUpperCase();
    }
    if (user && user.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return '';
  }

  get userDisplayName(): string {
    const user = this.user();
    if (user && user.displayName) {
      return user.displayName;
    }
    if (user && user.email) {
      return user.email;
    }
    return '';
  }

  get userEmail(): string {
    return this.user()?.email ?? '';
  }

  get userPhotoURL(): string | null {
    return this.user()?.photoURL ?? null;
  }

  stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
      const value = (hash >> (i * 8)) & 0xff;
      color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
  }

  get avatarColor(): string {
    const email = this.userEmail;
    if (email) {
      return this.stringToColor(email);
    }
    return '#000000'; // Default color
  }

  toggleMenu() {
    this.menuOpen.set(!this.menuOpen());
  }

  logout() {
    this.firebaseService.logout();
    this.menuOpen.set(false);
  }
}
