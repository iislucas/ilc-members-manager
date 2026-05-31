import {
  ApplicationConfig,
  InjectionToken,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { environment } from '../environments/environment';
import { provideHttpClient } from '@angular/common/http';
import { addUrlParams, pathPattern, pv } from './routing.utils';
import { RoutingConfig } from './routing.service';

export enum Views {
  ClassCalendarView = 'classCalendarView',
  SchoolCalendarView = 'schoolCalendarView',
  ClassVideoLibrary = 'classVideoLibrary',
  FindAnInstructor = 'findAnInstructor',
  FindSchool = 'findSchool',
  Home = 'home',
  ImportExport = 'importExport',
  InstructorsArea = 'instructorsArea',
  InstructorsAreaCategory = 'instructorsAreaCategory',
  InstructorsAreaPost = 'instructorsAreaPost',
  InstructorStudents = 'instructorStudents',
  InstructorStudentView = 'instructorStudentView',
  Login = 'login',
  ManageGradings = 'manageGradings',
  GradingView = 'gradingView',
  ManageMembers = 'manageMembers',
  ManageMemberView = 'manageMemberView',
  ManageOrders = 'manageOrders',
  ManageSchools = 'schools',
  ManageSchoolEdit = 'manageSchoolEdit',
  MemberGradings = 'memberGradings',
  MembersArea = 'membersArea',
  MembersAreaCategory = 'membersAreaCategory',
  MembersAreaPost = 'membersAreaPost',
  MyProfile = 'myProfile',
  MySchools = 'mySchools',
  MySchoolEdit = 'mySchoolEdit',
  MyStudents = 'myStudents',
  MyStudentView = 'myStudentView',
  OrderView = 'orderView',
  SchoolMembers = 'schoolMembers',
  SchoolMemberView = 'schoolMemberView',
  Settings = 'settings',
  Statistics = 'statistics',
  NewMember = 'newMember',
  EventsCalendar = 'eventsCalendar',
  EventView = 'eventView',
  EventEdit = 'eventEdit',
  ProposeEvent = 'proposeEvent',
  ManageEvents = 'manageEvents',
  MyEvents = 'myEvents',
  MyEventView = 'myEventView',
  ManageEventView = 'manageEventView',
  MyEventEdit = 'myEventEdit',
  ManageEventEdit = 'manageEventEdit',
  DownloadResource = 'downloadResource',
  NotificationSettings = 'notificationSettings',
  Notifications = 'notifications',
}

export const memberListPathPatterns = {
  [Views.MyStudents]: addUrlParams(pathPattern`my-students`, [
    'jumpTo', 'q', 'tag',
    { name: 'sortBy', default: 'lastUpdated' },
    { name: 'sortDir', default: 'desc' },
  ]),
  [Views.SchoolMembers]: addUrlParams(
    pathPattern`school/${pv('schoolId')}/members`,
    [
      'jumpTo', 'q', 'tag',
      { name: 'sortBy', default: 'lastUpdated' },
      { name: 'sortDir', default: 'desc' },
    ],
  ),
  [Views.InstructorStudents]: addUrlParams(
    pathPattern`instructor/${pv('instructorId')}/students`,
    [
      'jumpTo', 'q', 'tag',
      { name: 'sortBy', default: 'lastUpdated' },
      { name: 'sortDir', default: 'desc' },
    ],
  ),
};

export type MemberListPathPatterns = typeof memberListPathPatterns;
export type MemberListPathPatternsIds = keyof MemberListPathPatterns;

export const initPathPatterns = {
  ...memberListPathPatterns,
  [Views.Home]: pathPattern``,
  [Views.Login]: addUrlParams(pathPattern`login`, ['returnUrl']),
  [Views.ClassCalendarView]: pathPattern`calendar/instructor/${pv('instructorId')}`,
  [Views.SchoolCalendarView]: pathPattern`calendar/school/${pv('schoolId')}`,
  [Views.ImportExport]: addUrlParams(pathPattern`import-export`, ['tab']),
  [Views.FindAnInstructor]: addUrlParams(pathPattern`find-an-instructor`, ['instructorId', 'q']),
  [Views.FindSchool]: addUrlParams(pathPattern`find-school`, ['schoolId', 'q']),
  [Views.ManageSchools]: addUrlParams(pathPattern`schools`, ['q']),
  [Views.ManageSchoolEdit]: pathPattern`schools/${pv('schoolId')}/edit`,
  [Views.MyProfile]: pathPattern`myProfile`,
  [Views.ManageMembers]: addUrlParams(pathPattern`members`, [
    'jumpTo', 'q', 'tag',
    { name: 'sortBy', default: 'lastUpdated' },
    { name: 'sortDir', default: 'desc' },
  ]),
  [Views.ManageMemberView]: pathPattern`members/${pv('memberId')}`,
  [Views.SchoolMemberView]: pathPattern`school/${pv('schoolId')}/members/${pv('memberId')}`,
  [Views.InstructorStudentView]: pathPattern`instructor/${pv('instructorId')}/students/${pv('memberId')}`,
  [Views.MyStudentView]: pathPattern`my-students/${pv('memberId')}`,
  [Views.MySchools]: addUrlParams(pathPattern`my-schools`, ['q']),
  [Views.MySchoolEdit]: pathPattern`my-schools/${pv('schoolId')}/edit`,
  [Views.MembersArea]: pathPattern`members-area`,
  [Views.MembersAreaCategory]: pathPattern`members-area/category/${pv('category')}`,
  [Views.InstructorsArea]: pathPattern`instructors-area`,
  [Views.InstructorsAreaCategory]: pathPattern`instructors-area/category/${pv('category')}`,
  [Views.ManageGradings]: addUrlParams(pathPattern`gradings`, ['tab']),
  [Views.GradingView]: pathPattern`gradings/${pv('gradingId')}`,
  [Views.MemberGradings]: addUrlParams(pathPattern`my-gradings`, ['tab']),
  [Views.Settings]: addUrlParams(pathPattern`settings`, ['tab']),
  [Views.NotificationSettings]: pathPattern`settings/notifications`,
  [Views.Notifications]: addUrlParams(pathPattern`notifications`, ['filter']),
  [Views.ClassVideoLibrary]: pathPattern`class-video-library`,
  [Views.ManageOrders]: addUrlParams(pathPattern`orders`, [
    'orderId', 'q', 'startDate', 'endDate', 'status', 'kind',
    { name: 'searchMode', default: 'recent' },
    { name: 'searchField', default: 'email' },
    { name: 'sortBy', default: 'default' },
    { name: 'sortDir', default: 'desc' },
  ]),
  [Views.OrderView]: pathPattern`order-view/${pv('orderId')}`,
  [Views.MembersAreaPost]: pathPattern`members-area/post/${pv('blogPostPath')}`,
  [Views.InstructorsAreaPost]: pathPattern`instructors-area/post/${pv('blogPostPath')}`,
  [Views.NewMember]: addUrlParams(pathPattern`new-member`, ['basePath']),
  [Views.Statistics]: pathPattern`statistics`,
  [Views.EventsCalendar]: addUrlParams(pathPattern`events`, ['q', 'fromDate']),
  [Views.EventView]: pathPattern`events/${pv('eventId')}`,
  [Views.MyEventView]: pathPattern`my-events/${pv('eventId')}`,
  [Views.ManageEventView]: pathPattern`manage-events/${pv('eventId')}`,
  [Views.EventEdit]: pathPattern`events/${pv('eventId')}/edit`,
  [Views.MyEventEdit]: pathPattern`my-events/${pv('eventId')}/edit`,
  [Views.ManageEventEdit]: pathPattern`manage-events/${pv('eventId')}/edit`,
  [Views.ProposeEvent]: pathPattern`organise-event`,
  [Views.ManageEvents]: addUrlParams(pathPattern`manage-events`, [
    'q', 'status', 'startDate', 'endDate',
    { name: 'sortBy', default: 'start' },
    { name: 'sortDir', default: 'asc' },
    { name: 'searchMode', default: 'date' },
    { name: 'searchField', default: 'title' },
  ]),
  [Views.MyEvents]: addUrlParams(pathPattern`my-events`, ['q', 'fromDate', 'status', 'sortBy', 'sortDir']),
  [Views.DownloadResource]: pathPattern`resources/${pv('accessLevel')}/${pv('fileName')}`,
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
      // Eager IIFE: initializeApp registers the default Firebase app at module-load
      // time, which is required by services that call getFirestore() with no arguments.
      // Emulator connections are also set up here, before any service accesses Firestore.
      useValue: (() => {
        const app = initializeApp(environment.firebase);
        if (environment.useEmulator) {
          connectFirestoreEmulator(getFirestore(app), 'localhost', 8080);
          connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099', { disableWarnings: true });
          connectFunctionsEmulator(getFunctions(app), 'localhost', 5001);
          connectStorageEmulator(getStorage(app), 'localhost', 9199);
        }
        return app;
      })(),
    },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
