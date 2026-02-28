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
  ManageMemberView = 'manageMemberView',
  ImportExport = 'importExport',
  FindAnInstructor = 'findAnInstructor',
  FindSchool = 'findSchool',
  ManageSchools = 'schools',
  SchoolMembers = 'schoolMembers',
  SchoolMemberView = 'schoolMemberView',
  InstructorStudents = 'instructorStudents',
  InstructorStudentView = 'instructorStudentView',
  Home = 'home',
  MyStudents = 'myStudents',
  MyStudentView = 'myStudentView',
  MySchools = 'mySchools',
  ActiveMembers = 'activeMembers',
  ActiveMembersCategory = 'activeMembersCategory',
  ActiveInstructors = 'activeInstructors',
  ActiveInstructorsCategory = 'activeInstructorsCategory',
  ManageGradings = 'manageGradings',
  MemberGradings = 'memberGradings',
  Settings = 'settings',
  ClassVideoLibrary = 'classVideoLibrary',
  ManageOrders = 'manageOrders',
  OrderView = 'orderView',
  ActiveMemberPost = 'activeMemberPost',
  ActiveInstructorPost = 'activeInstructorPost',
  Login = 'login',
}

export const initPathPatterns = {
  [Views.Home]: pathPattern``,
  [Views.Login]: pathPattern`login`,
  [Views.ImportExport]: pathPattern`import-export`,
  [Views.FindAnInstructor]: addUrlParams(pathPattern`find-an-instructor`, ['instructorId', 'q']),
  [Views.FindSchool]: addUrlParams(pathPattern`find-school`, ['schoolId', 'q']),
  [Views.ManageSchools]: addUrlParams(pathPattern`schools`, ['schoolId', 'q']),
  [Views.MyProfile]: pathPattern`myProfile`,
  [Views.ManageMembers]: addUrlParams(pathPattern`members`, ['jumpTo', 'q']),
  [Views.ManageMemberView]: pathPattern`members/${pv('memberId')}`,
  [Views.SchoolMembers]: addUrlParams(
    pathPattern`school/${pv('schoolId')}/members`,
    ['jumpTo', 'q'],
  ),
  [Views.SchoolMemberView]: pathPattern`school/${pv('schoolId')}/members/${pv('memberId')}`,
  [Views.InstructorStudents]: addUrlParams(
    pathPattern`instructor/${pv('instructorId')}/students`,
    ['jumpTo', 'q'],
  ),
  [Views.InstructorStudentView]: pathPattern`instructor/${pv('instructorId')}/students/${pv('memberId')}`,
  [Views.MyStudents]: addUrlParams(pathPattern`my-students`, ['jumpTo', 'q']),
  [Views.MyStudentView]: pathPattern`my-students/${pv('memberId')}`,
  [Views.MySchools]: addUrlParams(pathPattern`my-schools`, ['schoolId', 'q']),
  [Views.ActiveMembers]: pathPattern`members-area`,
  [Views.ActiveMembersCategory]: pathPattern`members-area/${pv('category')}`,
  [Views.ActiveInstructors]: pathPattern`instructors-area`,
  [Views.ActiveInstructorsCategory]: pathPattern`instructors-area/${pv('category')}`,
  [Views.ManageGradings]: pathPattern`gradings`,
  [Views.MemberGradings]: pathPattern`my-gradings`,
  [Views.Settings]: pathPattern`settings`,
  [Views.ClassVideoLibrary]: pathPattern`class-video-library`,
  [Views.ManageOrders]: addUrlParams(pathPattern`orders`, ['orderId']),
  [Views.OrderView]: pathPattern`order-view/${pv('orderId')}`,
  [Views.ActiveMemberPost]: pathPattern`members-area/post/${pv('blogPostPath')}`,
  [Views.ActiveInstructorPost]: pathPattern`instructors-area/post/${pv('blogPostPath')}`,
};

// Santiy check for type correctness...
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, []).pathVars
  .schoolId;
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, ['jumpTo'])
  .urlParams.jumpTo;
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, ['jumpTo'])
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
