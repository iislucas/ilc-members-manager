// Template: make a copy with your domains, named environment.ts
const domains = [
  `https://iliqchuan.com`,
  `https://www.iliqchuan.com`,
  `http://iliqchuan.com`,
  `http://www.iliqchuan.com`,
  `https://app.zxd.fr`,
  `https://app.iliqchuan.com`,
  `https://app.zxd.fr`,
  'http://localhost:4200',
  'https://ilc-paris-class-tracker.firebaseapp.com',
  'https://lute-denim-99n2.squarespace.com',
];
export const environment = {
  domains,
  CLOUD_BUCKET_NAME_AND_ROOT_PATH: 'resources.zxd.fr',
  CORS_CONFIG: [
    {
      origin: [...domains, 'https://storage.googleapis.com'],
      method: ['GET'],
      responseHeader: ['Content-Type'],
      maxAgeSeconds: 300,
    }
  ],
  googleCalendar: {
    calendarId: '06se06gf82c428olklnjagbt6c@group.calendar.google.com',
  },
};
