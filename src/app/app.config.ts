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
  ManageMembers = 'manageMembers',
  ImportExport = 'importExport',
  FindAnInstructor = 'findAnInstructor',
  Schools = 'schools',
  SchoolMembers = 'schoolMembers',
  Home = 'home',
}

export const initPathPatterns = {
  [Views.Home]: pathPattern``,
  [Views.ImportExport]: pathPattern`import-export`,
  [Views.FindAnInstructor]: pathPattern`find-an-instructor`,
  [Views.Schools]: addUrlParams(pathPattern`schools`, ['schoolId']),
  [Views.ManageMembers]: addUrlParams(pathPattern`members`, ['memberId']),
  [Views.SchoolMembers]: addUrlParams(
    pathPattern`school/${pv('schoolId')}/members`,
    ['memberId'],
  ),
};

// Santiy check for type correctness...
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, []).pathVars
  .schoolId;
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, ['memberId'])
  .urlParams.memberId;
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, ['memberId'])
  .pathVars.schoolId;

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
