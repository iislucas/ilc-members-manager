import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FirebaseStateService } from './firebase-state.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AuthErrorCodes } from 'firebase/auth';
import { CalendarView } from './calendar-view/calendar-view';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule, ReactiveFormsModule, CalendarView],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected title = 'ilc-members-manager';
  public firebaseService = inject(FirebaseStateService);

  // One error/success message signal for each user action
  public loginWithEmailError = signal<string | null>(null);
  public invalidLoginCredentials = signal<boolean>(false);
  public loginWithGoogleError = signal<string | null>(null);
  public signupError = signal<string | null>(null);
  public resetPasswordError = signal<string | null>(null);
  public resetPasswordSuccess = signal<string | null>(null);
  public logoutError = signal<string | null>(null);

  public async loginWithGoogle() {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithGoogle();
    if (!result.success) {
      this.loginWithGoogleError.set(result.errorMessage);
    }
  }

  public async loginWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithEmail(pass, email);
    if (!result.success) {
      this.loginWithEmailError.set(result.errorMessage);
      if (result.errorMessage === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS) {
        this.invalidLoginCredentials.set(true);
      }
    }
  }

  public async signupWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.signupWithEmail(pass, email);
    if (!result.success) {
      this.signupError.set(result.errorMessage);
    }
  }

  public async resetPassword(email: string) {
    this.dismissMessages();
    if (!email) {
      this.resetPasswordError.set(
        'Please enter your email address to reset your password.'
      );
      return;
    }
    const result = await this.firebaseService.resetPassword(email);
    if (result.success) {
      this.resetPasswordSuccess.set(
        'A password reset link has been sent to your email.'
      );
    } else {
      this.resetPasswordError.set(result.errorMessage);
    }
  }

  public async logout() {
    this.dismissMessages();
    const result = await this.firebaseService.logout();
    if (!result.success) {
      this.logoutError.set(result.errorMessage);
    }
  }

  public dismissMessages() {
    this.loginWithEmailError.set(null);
    this.invalidLoginCredentials.set(false);
    this.loginWithGoogleError.set(null);
    this.signupError.set(null);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.logoutError.set(null);
  }
}
