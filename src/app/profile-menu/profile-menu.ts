import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageLoaderService } from '../image-loader.service';
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
  public imageLoader = inject(ImageLoaderService);
  public user = this.firebaseService.user;
  public menuOpen = signal(false);
  // TODO: loadedImage should be a linkedSignal, and we can skip the effect in
  // the constructor I think.
  public loadedImage = signal<string | null>(null);

  constructor() {
    effect(
      () => {
        const url = this.userPhotoURL;
        this.loadedImage.set(null);
        if (url) {
          this.imageLoader.loadImage(url).then(
            (blobUrl) => this.loadedImage.set(blobUrl),
            () => this.loadedImage.set(null),
          );
        }
      }
    );
  }

  get userInitial(): string {
    const user = this.user();
    if (user && user.firebaseUser.displayName) {
      return user.firebaseUser.displayName.charAt(0).toUpperCase();
    }
    if (user && user.firebaseUser.email) {
      return user.firebaseUser.email.charAt(0).toUpperCase();
    }
    return '';
  }

  get userDisplayName(): string {
    const user = this.user();
    if (user && user.firebaseUser.displayName) {
      return user.firebaseUser.displayName;
    }
    if (user && user.firebaseUser.email) {
      return user.firebaseUser.email;
    }
    return '';
  }

  get userEmail(): string {
    return this.user()?.firebaseUser.email ?? '';
  }

  get userPhotoURL(): string | null {
    return this.user()?.firebaseUser.photoURL ?? null;
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
