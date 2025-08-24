import {
  ApplicationConfig,
  InjectionToken,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { addUrlParams, pathPattern, pv } from './routing.utils';
import { RoutingConfig } from './routing.service';

export enum Views {
  AllMembers = 'allMembers',
  ImportExport = 'importExport',
  FindAnInstructor = 'findAnInstructor',
  Schools = 'schools',
  SchoolMembers = 'schoolMembers',
  Home = 'home',
}

export const initPathPatterns = {
  [Views.ImportExport]: pathPattern`import-export`,
  [Views.AllMembers]: addUrlParams(pathPattern`all-members`, ['memberId']),
  [Views.FindAnInstructor]: pathPattern`find-an-instructor`,
  [Views.Home]: pathPattern``,
  [Views.Schools]: pathPattern`schools`,
  [Views.SchoolMembers]: addUrlParams(
    pathPattern`school/${pv('schoolId')}/members`,
    ['memberId']
  ),
};

export type AppPathPatterns = typeof initPathPatterns;
export type PathPatternsIds = keyof typeof initPathPatterns;

// Defines the injection tag (global namespace)
export const ROUTING_CONFIG = new InjectionToken<
  RoutingConfig<AppPathPatterns>
>('routing.config');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    {
      provide: ROUTING_CONFIG,
      useValue: { validPathPatterns: initPathPatterns },
    },
  ],
};
