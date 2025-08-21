import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { ROUTING_CONFIG } from './routing.config';

export enum Views {
  Members = 'members',
  ImportExport = 'import-export',
  FindAnInstructor = 'find-an-instructor',
}

export type PathParamValues = {
  view: Views;
};

export const routerInitValues: PathParamValues = {
  view: Views.Members,
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    {
      provide: ROUTING_CONFIG,
      useValue: {
        pathParams: {
          view: Views.Members,
        },
        urlParams: {
          memberId: '',
        },
        paths: ['/:view'],
      },
    },
  ],
};
