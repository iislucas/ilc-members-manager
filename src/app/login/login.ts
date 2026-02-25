import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { AuthErrorCodes } from 'firebase/auth';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  public firebaseService = inject(FirebaseStateService);
  public LoginStatus = LoginStatus;

  // Login form state
  public showPassword = signal<boolean>(false);
  public loginEmail = signal<string>('');
  public loginPassword = signal<string>('');

  // Error/success message signals
  public loginWithEmailError = signal<string | null>(null);
  public invalidLoginCredentials = signal<boolean>(false);
  public emailAlreadyInUse = signal<boolean>(false);
  public loginWithGoogleError = signal<string | null>(null);
  public signupError = signal<string | null>(null);
  public resetPasswordError = signal<string | null>(null);
  public resetPasswordSuccess = signal<string | null>(null);

  public async loginWithGoogle() {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithGoogle();
    if (!result.success) {
      console.warn(result.errorCode);
      this.loginWithGoogleError.set(result.errorCode);
    }
  }

  public async loginWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithEmail(pass, email);
    if (!result.success) {
      console.warn(result.errorCode);
      if (result.errorCode === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS) {
        this.invalidLoginCredentials.set(true);
      } else {
        this.loginWithEmailError.set(`${result.errorCode}: check you are online?`);
      }
    }
  }

  public async signupWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.signupWithEmail(pass, email);
    if (!result.success) {
      console.warn(result.errorCode);
      if (result.errorCode === AuthErrorCodes.EMAIL_EXISTS) {
        this.emailAlreadyInUse.set(true);
      } else {
        this.signupError.set(`${result.errorCode}: check you are online?`);
      }
    }
  }

  public async resetPassword(email: string) {
    this.dismissMessages();
    if (!email) {
      console.warn('resetPasswordError: no email provided');
      this.resetPasswordError.set('Please enter your email address to reset your password.');
      return;
    }
    const result = await this.firebaseService.resetPassword(email);
    if (result.success) {
      this.resetPasswordSuccess.set('A password reset link has been sent to your email.');
    } else {
      console.warn(result.errorMessage);
      this.resetPasswordError.set(result.errorMessage);
    }
  }

  public dismissMessages() {
    this.loginWithEmailError.set(null);
    this.invalidLoginCredentials.set(false);
    this.emailAlreadyInUse.set(false);
    this.loginWithGoogleError.set(null);
    this.signupError.set(null);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.firebaseService.loginError.set(null);
  }
}
