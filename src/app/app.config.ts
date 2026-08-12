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
  InstructorView = 'instructorView',
  FindSchool = 'findSchool',
  SchoolView = 'schoolView',
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
  Products = 'products',
  OrderComplete = 'orderComplete',
  MyOrders = 'myOrders',
  MyMaterials = 'myMaterials',
  Videos = 'videos',
  VideoView = 'videoView',
  ManageVod = 'manageVod',
  BecomeAMember = 'becomeAMember',
  NextGrading = 'nextGrading',
  InstructorLicensePurchase = 'instructorLicensePurchase',
  SchoolLicensePurchase = 'schoolLicensePurchase',
  ClassVideoLibraryPurchase = 'classVideoLibraryPurchase',
}

// Views that are accessible without login.
export const PUBLIC_VIEWS: ReadonlySet<Views> = new Set([
  Views.FindAnInstructor,
  Views.InstructorView,
  Views.FindSchool,
  Views.SchoolView,
  Views.EventsCalendar,
  Views.EventView,
  Views.ClassCalendarView,
  Views.SchoolCalendarView,
  Views.DownloadResource,
  Views.Products,
  Views.OrderComplete,
  Views.Videos,
  Views.VideoView,
  Views.BecomeAMember,
  Views.NextGrading,
  Views.InstructorLicensePurchase,
  Views.SchoolLicensePurchase,
  Views.ClassVideoLibraryPurchase,
]);

export const memberListPathPatterns = {
  [Views.MyStudents]: addUrlParams(pathPattern`my-students`, [
    { name: 'jumpTo', ephemeral: true }, 'q', 'tag',
    { name: 'sortBy', default: 'lastUpdated' },
    { name: 'sortDir', default: 'desc' },
  ]),
  [Views.SchoolMembers]: addUrlParams(
    pathPattern`school/${pv('schoolId')}/members`,
    [
      { name: 'jumpTo', ephemeral: true }, 'q', 'tag',
      { name: 'sortBy', default: 'lastUpdated' },
      { name: 'sortDir', default: 'desc' },
    ],
  ),
  [Views.InstructorStudents]: addUrlParams(
    pathPattern`instructor/${pv('instructorId')}/students`,
    [
      { name: 'jumpTo', ephemeral: true }, 'q', 'tag',
      { name: 'sortBy', default: 'lastUpdated' },
      { name: 'sortDir', default: 'desc' },
    ],
  ),
};

export type MemberListPathPatterns = typeof memberListPathPatterns;
export type MemberListPathPatternsIds = keyof MemberListPathPatterns;

export const initPathPatterns = {
  ...memberListPathPatterns,
  [Views.Home]: addUrlParams(pathPattern``, [
    'tab',
    { name: 'session_id', ephemeral: true },
    { name: 'welcome', ephemeral: true },
  ]),
  [Views.Login]: addUrlParams(pathPattern`login`, [{ name: 'returnUrl', ephemeral: true }]),
  [Views.ClassCalendarView]: pathPattern`calendar/instructor/${pv('instructorId')}`,
  [Views.SchoolCalendarView]: pathPattern`calendar/school/${pv('schoolId')}`,
  [Views.ImportExport]: addUrlParams(pathPattern`import-export`, ['tab']),
  [Views.FindAnInstructor]: addUrlParams(pathPattern`find-an-instructor`, ['instructorId', 'q']),
  [Views.InstructorView]: pathPattern`instructors/${pv('instructorId')}`,
  [Views.FindSchool]: addUrlParams(pathPattern`find-school`, ['schoolId', 'q']),
  [Views.ManageSchools]: addUrlParams(pathPattern`schools`, ['q']),
  [Views.SchoolView]: pathPattern`school-profile/${pv('schoolId')}`,
  [Views.ManageSchoolEdit]: pathPattern`schools/${pv('schoolId')}/edit`,
  [Views.MyProfile]: pathPattern`myProfile`,
  [Views.ManageMembers]: addUrlParams(pathPattern`members`, [
    { name: 'jumpTo', ephemeral: true }, 'q', 'tag',
    { name: 'sortBy', default: 'lastUpdated' },
    { name: 'sortDir', default: 'desc' },
  ]),
  [Views.ManageMemberView]: pathPattern`members/${pv('memberId')}`,
  [Views.SchoolMemberView]: pathPattern`school/${pv('schoolId')}/members/${pv('memberId')}`,
  [Views.InstructorStudentView]: pathPattern`instructor/${pv('instructorId')}/students/${pv('memberId')}`,
  [Views.MyStudentView]: pathPattern`my-students/${pv('memberId')}`,
  [Views.MySchools]: addUrlParams(pathPattern`my-schools`, ['q']),
  [Views.MySchoolEdit]: pathPattern`my-schools/${pv('schoolId')}/edit`,
  [Views.MembersArea]: addUrlParams(pathPattern`members-area`, ['category']),
  [Views.MembersAreaCategory]: pathPattern`members-area/category/${pv('category')}`,
  [Views.InstructorsArea]: addUrlParams(pathPattern`instructors-area`, ['category']),
  [Views.InstructorsAreaCategory]: pathPattern`instructors-area/category/${pv('category')}`,
  [Views.ManageGradings]: addUrlParams(pathPattern`gradings`, [
    'tab',
    'event',
    'groupDate',
    'groupInstructor',
    'q',
    'startDate',
    'endDate',
    'status',
    'studentMemberDocId',
    'studentMemberId',
    'instructorId',
    'orderId',
    'unpaid',
    { name: 'sortBy', default: 'lastUpdated' },
    { name: 'sortDir', default: 'desc' },
  ]),
  [Views.GradingView]: addUrlParams(pathPattern`gradings/${pv('gradingId')}`, [{ name: 'from', ephemeral: true }]),
  [Views.MemberGradings]: addUrlParams(pathPattern`my-gradings`, [
    'tab',
    'event',
    'groupDate',
    'groupInstructor',
    'q',
    'startDate',
    'endDate',
    'status',
    'studentMemberDocId',
    'studentMemberId',
    'instructorId',
    'orderId',
    'unpaid',
  ]),
  [Views.Settings]: addUrlParams(pathPattern`settings`, ['tab']),
  [Views.NotificationSettings]: pathPattern`settings/notifications`,
  [Views.Notifications]: addUrlParams(pathPattern`notifications`, ['filter', 'style']),
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
  [Views.NewMember]: addUrlParams(pathPattern`new-member`, [{ name: 'basePath', ephemeral: true }]),
  [Views.Statistics]: pathPattern`statistics`,
  [Views.EventsCalendar]: addUrlParams(pathPattern`events`, ['q', 'fromDate', 'schoolId', 'instructorId']),
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
  // Standalone Stripe purchase flow. Intentionally not linked from the home
  // page or navigation — reachable directly via its URL.
  [Views.Products]: pathPattern`products`,
  [Views.OrderComplete]: addUrlParams(pathPattern`order-complete`, [{ name: 'session_id', ephemeral: true }]),
  [Views.MyOrders]: addUrlParams(pathPattern`my-orders`, ['tab']),
  [Views.MyMaterials]: addUrlParams(pathPattern`my-materials`, [
    'q', 'tag', 'date', 'eventId', 'type', 'location',
  ]),
  [Views.ManageMaterials]: addUrlParams(pathPattern`manage-materials`, [
    'q', 'tag', 'date', 'startDate', 'endDate', 'eventId', 'type', 'instructorId', 'memberId', 'memberDocId', 'location',
  ]),
  [Views.BecomeAMember]: addUrlParams(pathPattern`become-a-member`, [
    { name: 'session_id', ephemeral: true },
    { name: 'step', ephemeral: true },
  ]),
  [Views.NextGrading]: addUrlParams(pathPattern`next-grading`, [
    { name: 'session_id', ephemeral: true },
  ]),
  [Views.InstructorLicensePurchase]: addUrlParams(pathPattern`instructor-license`, [
    { name: 'session_id', ephemeral: true },
  ]),
  [Views.SchoolLicensePurchase]: addUrlParams(pathPattern`school-license`, [
    { name: 'session_id', ephemeral: true },
    'schoolId',
  ]),
  [Views.ClassVideoLibraryPurchase]: addUrlParams(pathPattern`class-video-library-subscription`, [
    { name: 'session_id', ephemeral: true },
  ]),
  [Views.Videos]: addUrlParams(pathPattern`videos`, [
    'q', 'category', 'tag', 'instructorId', 'tier',
  ]),
  [Views.VideoView]: addUrlParams(pathPattern`videos/${pv('videoId')}`, []),
  [Views.ManageVod]: addUrlParams(pathPattern`manage-vod`, [
    'q', 'status', 'category', 'instructorId',
  ]),
};

// Santiy check for type correctness...
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, []).pathVars
  .schoolId;
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, ['jumpTo'])
  .urlParams.jumpTo;
addUrlParams(pathPattern`school/${pv('schoolId')}/members`, [{ name: 'jumpTo', ephemeral: true }])
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
