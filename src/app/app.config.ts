import {
  ApplicationConfig,
  InjectionToken,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { FirebaseApp, initializeApp } from 'firebase/app';
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
  ManageMembers = 'manageMembers',
  ManageMemberView = 'manageMemberView',
  ManageOrders = 'manageOrders',
  ManageSchools = 'schools',
  MemberGradings = 'memberGradings',
  MembersArea = 'membersArea',
  MembersAreaCategory = 'membersAreaCategory',
  MembersAreaPost = 'membersAreaPost',
  MyProfile = 'myProfile',
  MySchools = 'mySchools',
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
}

export const memberListPathPatterns = {
  [Views.MyStudents]: addUrlParams(pathPattern`my-students`, ['jumpTo', 'q', 'sortBy', 'sortDir', 'tag']),
  [Views.SchoolMembers]: addUrlParams(
    pathPattern`school/${pv('schoolId')}/members`,
    ['jumpTo', 'q', 'sortBy', 'sortDir', 'tag'],
  ),
  [Views.InstructorStudents]: addUrlParams(
    pathPattern`instructor/${pv('instructorId')}/students`,
    ['jumpTo', 'q', 'sortBy', 'sortDir', 'tag'],
  ),
};

export type MemberListPathPatterns = typeof memberListPathPatterns;
export type MemberListPathPatternsIds = keyof MemberListPathPatterns;

export const initPathPatterns = {
  ...memberListPathPatterns,
  [Views.Home]: pathPattern``,
  [Views.Login]: pathPattern`login`,
  [Views.ClassCalendarView]: pathPattern`calendar/instructor/${pv('instructorId')}`,
  [Views.SchoolCalendarView]: pathPattern`calendar/school/${pv('schoolId')}`,
  [Views.ImportExport]: pathPattern`import-export`,
  [Views.FindAnInstructor]: addUrlParams(pathPattern`find-an-instructor`, ['instructorId', 'q']),
  [Views.FindSchool]: addUrlParams(pathPattern`find-school`, ['schoolId', 'q']),
  [Views.ManageSchools]: addUrlParams(pathPattern`schools`, ['schoolId', 'q']),
  [Views.MyProfile]: pathPattern`myProfile`,
  [Views.ManageMembers]: addUrlParams(pathPattern`members`, ['jumpTo', 'q', 'sortBy', 'sortDir', 'tag']),
  [Views.ManageMemberView]: pathPattern`members/${pv('memberId')}`,
  [Views.SchoolMemberView]: pathPattern`school/${pv('schoolId')}/members/${pv('memberId')}`,
  [Views.InstructorStudentView]: pathPattern`instructor/${pv('instructorId')}/students/${pv('memberId')}`,
  [Views.MyStudentView]: pathPattern`my-students/${pv('memberId')}`,
  [Views.MySchools]: addUrlParams(pathPattern`my-schools`, ['schoolId', 'q']),
  [Views.MembersArea]: pathPattern`members-area`,
  [Views.MembersAreaCategory]: pathPattern`members-area/category/${pv('category')}`,
  [Views.InstructorsArea]: pathPattern`instructors-area`,
  [Views.InstructorsAreaCategory]: pathPattern`instructors-area/category/${pv('category')}`,
  [Views.ManageGradings]: pathPattern`gradings`,
  [Views.MemberGradings]: pathPattern`my-gradings`,
  [Views.Settings]: pathPattern`settings`,
  [Views.ClassVideoLibrary]: pathPattern`class-video-library`,
  [Views.ManageOrders]: addUrlParams(pathPattern`orders`, ['orderId', 'searchMode', 'searchField', 'q', 'startDate', 'endDate', 'sortBy', 'sortDir', 'status', 'kind']),
  [Views.OrderView]: pathPattern`order-view/${pv('orderId')}`,
  [Views.MembersAreaPost]: pathPattern`members-area/post/${pv('blogPostPath')}`,
  [Views.InstructorsAreaPost]: pathPattern`instructors-area/post/${pv('blogPostPath')}`,
  [Views.NewMember]: addUrlParams(pathPattern`new-member`, ['basePath']),
  [Views.Statistics]: pathPattern`statistics`,
  [Views.EventsCalendar]: pathPattern`events`,
  [Views.EventView]: pathPattern`events/${pv('eventId')}`,
  [Views.MyEventView]: pathPattern`my-events/${pv('eventId')}`,
  [Views.ManageEventView]: pathPattern`manage-events/${pv('eventId')}`,
  [Views.EventEdit]: pathPattern`events/${pv('eventId')}/edit`,
  [Views.MyEventEdit]: pathPattern`my-events/${pv('eventId')}/edit`,
  [Views.ManageEventEdit]: pathPattern`manage-events/${pv('eventId')}/edit`,
  [Views.ProposeEvent]: pathPattern`propose-event`,
  [Views.ManageEvents]: addUrlParams(pathPattern`manage-events`, ['q', 'status', 'sortBy', 'sortDir', 'searchMode', 'searchField', 'startDate', 'endDate']),
  [Views.MyEvents]: addUrlParams(pathPattern`my-events`, ['q', 'status', 'sortBy', 'sortDir']),
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
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
