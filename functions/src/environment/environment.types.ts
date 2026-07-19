// Server-Side Cloud Functions Environment Configuration Types
//
// This file defines the TypeScript interface contract for backend Cloud Functions environments
// (`functions/src/environment/environment.ts` and `functions/src/environment/environment.template.ts`).

// CORS configuration entry for Cloud Storage bucket access and cross-origin function endpoints.
export interface CorsConfigItem {
  // Array of allowed origins (e.g. 'https://iliqchuan.com')
  origin: string[];
  // Array of allowed HTTP methods (e.g. ['GET'])
  method: string[];
  // Array of allowed HTTP response headers
  responseHeader: string[];
  // Maximum age in seconds for CORS preflight cache
  maxAgeSeconds: number;
}

// Backend Cloud Functions environment configuration contract.
export interface FunctionsEnvironment {
  // Allowed domain names for origins, embeds, and web component hosts
  domains: string[];
  // Cloud Storage bucket name and root folder path for deployed web components
  CLOUD_BUCKET_NAME_AND_ROOT_PATH: string;
  // CORS rule definitions applied to Cloud Storage buckets and assets
  CORS_CONFIG: CorsConfigItem[];
  // Google Calendar integration settings
  googleCalendar: {
    // Target Google Calendar ID synced for event scheduling
    calendarId: string;
  };
  // Base64url VAPID public key for signing Web Push notifications
  vapidPublicKey: string;
  // Contact mailto: URI included in Web Push VAPID headers per Web Push specification
  pushContactEmail: string;
  // Outbound email notification settings
  email: {
    // Default 'From' email sender address (e.g. 'info@iliqchuan.com').
    // If left empty (''), outbound email notifications are disabled and only in-app alerts are created.
    from: string;
  };
  // Stripe API integration parameters
  stripe: {
    // Pinned Stripe API version string to ensure stable responses across SDK updates
    apiVersion: string;
  };
}
