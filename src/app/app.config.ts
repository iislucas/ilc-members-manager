import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { ROUTING_CONFIG } from './routing.config';
import { addUrlParams, pathPattern, PathPatterns, pv } from './routing.utils';

// export enum Views {
//   AllMembers = 'all-members',
//   ImportExport = 'import-export',
//   FindAnInstructor = 'find-an-instructor',
//   Schools = 'school',
//   SchoolMembers = 'school-members',
// }

// TODO: using inspiration from ts-llmt, make a string literal magic for path
// parts that also builds up the variables in the template.

const foo = addUrlParams(pathPattern`all-members`, ['memberId']);

export function initPathPatterns() {
  return {
    allMembers: addUrlParams(pathPattern`all-members`, ['memberId']),
    importExport: pathPattern`import-export`,
    findAnInstructor: pathPattern`find-an-instructor`,
    homeView: pathPattern``,
    schoolsView: pathPattern`schools`,
    schoolMembersView: addUrlParams(
      pathPattern`school/${pv('schoolId')}/members`,
      ['memberId']
    ),
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    {
      provide: ROUTING_CONFIG,
      useValue: { validPathPatterns: initPathPatterns() as PathPatterns },
    },
  ],
};
