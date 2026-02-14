import {
  ApplicationConfig,
  InjectionToken,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { environment } from '../environments/environment';
import { provideHttpClient } from '@angular/common/http';
import { addUrlParams, pathPattern, pv } from './routing.utils';
import { RoutingConfig } from './routing.service';

export enum Views {
  MyProfile = 'myProfile',
  ManageMembers = 'manageMembers',
  ImportExport = 'importExport',
  FindAnInstructor = 'findAnInstructor',
  FindSchool = 'findSchool',
  ManageSchools = 'schools',
  SchoolMembers = 'schoolMembers',
  Home = 'home',
  MyStudents = 'myStudents',
}

export const initPathPatterns = {
  [Views.Home]: pathPattern``,
  [Views.ImportExport]: pathPattern`import-export`,
  [Views.FindAnInstructor]: pathPattern`find-an-instructor`,
  [Views.FindSchool]: addUrlParams(pathPattern`find-school`, ['schoolId']),
  [Views.ManageSchools]: addUrlParams(pathPattern`schools`, ['schoolId']),
  [Views.MyProfile]: pathPattern`myProfile`,
  [Views.ManageMembers]: addUrlParams(pathPattern`members`, ['memberId']),
  [Views.SchoolMembers]: addUrlParams(
    pathPattern`school/${pv('schoolId')}/members`,
    ['memberId'],
  ),
  [Views.MyStudents]: pathPattern`my-students`,
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

export const FIREBASE_APP = new InjectionToken<FirebaseApp>('firebase.app');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    {
      provide: ROUTING_CONFIG,
      useValue: { validPathPatterns: initPathPatterns },
    },
    {
      provide: FIREBASE_APP,
      useValue: initializeApp(environment.firebase),
    },
  ],
};
