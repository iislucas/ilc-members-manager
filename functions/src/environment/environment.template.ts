// Template: make a copy with your domains, named environment.ts
import { FunctionsEnvironment } from './environment.types.js';

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
export const environment: FunctionsEnvironment = {
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
  // Web Push (VAPID). Public key must match the client's environment.vapidPublicKey;
  // the private key is provided via the VAPID_PRIVATE_KEY secret. Empty disables push.
  vapidPublicKey: '',
  pushContactEmail: 'mailto:admin@example.com',
  // Where the links in notifications and emails point. `appBase` is only needed
  // to make email links absolute; in-app links use the paths on their own.
  links: {
    appBase: 'https://app.iliqchuan.com',
    instructorSopPath: '/instructors-area/post/instructor-packet',
  },
  // Email addresses. `from` is the sender — leave it empty to disable outbound
  // email. `contact` is only displayed, so members always have somewhere to
  // write even when sending is off.
  email: {
    from: '', // e.g. 'web-helper-team@iliqchuan.com'
    contact: 'web-helper-team@iliqchuan.com',
  },
  // Stripe integration. The secret key is provided via the STRIPE_SECRET_KEY
  // secret (defineSecret), not stored here. Only non-secret config lives here.
  stripe: {
    apiVersion: '2026-04-22.dahlia' as const,
  },
};
