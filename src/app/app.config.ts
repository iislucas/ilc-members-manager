import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { PathPatterns, ROUTING_CONFIG } from './routing.config';

export enum Views {
  AllMembers = 'all-members',
  ImportExport = 'import-export',
  FindAnInstructor = 'find-an-instructor',
  Schools = 'school',
  SchoolMembers = 'school-members',
}

export function initPathPatterns() {
  return {
    allMembers: {
      varMap: {},
      pathPattern: ['all-members'],
      urlParamKeys: ['memberId'],
    },
    importExport: {
      varMap: {},
      pathPattern: ['import-export'],
      urlParamKeys: [],
    },
    findAnInstructor: {
      varMap: {},
      pathPattern: ['find-an-instructor'],
      urlParamKeys: [],
    },
    schoolsView: {
      varMap: {},
      pathPattern: ['school'],
      urlParamKeys: [],
    },
    schoolMembersView: {
      varMap: {
        schoolId: '' as string,
      },
      pathPattern: ['school', ':schoolId', 'members'],
      urlParamKeys: ['memberId'],
    },
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    {
      provide: ROUTING_CONFIG,
      useValue: initPathPatterns(),
    },
  ],
};
