// Server-Side Cloud Functions Environment Configuration Types
//
// This file defines the TypeScript interface contract for backend Cloud Functions environments
// (`functions/src/environment/environment.ts` and `functions/src/environment/environment.template.ts`).

// A single Cloud Storage CORS rule, matching the shape passed to
// `bucket.setCorsConfiguration()` by the web-component deploy scripts
// (scripts/deploy-events-wc.ts, scripts/deploy-find-instructor-wc.ts). These
// rules govern browser access to the deployed web components served from the
// resources bucket.
export interface CorsConfigItem {
  // Origins permitted to read the bucket's objects; the app `domains` list plus
  // 'https://storage.googleapis.com'.
  origin: string[];
  // HTTP methods allowed against the bucket (web components only need ['GET']).
  method: string[];
  // Response headers the browser is allowed to read (e.g. ['Content-Type']).
  responseHeader: string[];
  // How long (seconds) a browser may cache the CORS preflight response.
  maxAgeSeconds: number;
}

// Backend Cloud Functions environment configuration contract.
export interface FunctionsEnvironment {
  // Allowed request origins for the callable/HTTPS Cloud Functions. Exported
  // from common.ts as `allowedOrigins` and passed as the `cors` option to every
  // onCall/onRequest function; the current project's `<project>.web.app` origin
  // is appended at runtime.
  domains: string[];
  // Deploy target for the standalone web components, in `bucket/root-path` form
  // (e.g. 'resources.zxd.fr'). The deploy scripts split off the bucket name
  // before the first '/' and upload each component to its own subdirectory
  // (e.g. `<root>/calendar-viewer`, `<root>/find-an-instructor`).
  CLOUD_BUCKET_NAME_AND_ROOT_PATH: string;
  // CORS rules applied to the web-component storage bucket. The deploy scripts
  // push these to the bucket via setCorsConfiguration() so browsers on the
  // allowed origins can load the deployed components.
  CORS_CONFIG: CorsConfigItem[];
  // Base64url VAPID public key passed to webpush.setVapidDetails() in
  // send-push.ts. Must match the client's environment.vapidPublicKey, or
  // browsers reject the push; the paired private key comes from the
  // VAPID_PRIVATE_KEY secret, not this file.
  vapidPublicKey: string;
  // Contact mailto: URI included in Web Push VAPID headers per Web Push specification
  pushContactEmail: string;
  // Public URLs used when linking a member back into the app from a
  // notification or an outbound email.
  links: {
    // Origin the members app is served from, with no trailing slash
    // (e.g. 'https://app.iliqchuan.com'). Email links must be absolute, so they
    // are built from this; in-app notification links stay root-relative so they
    // also work on localhost and preview deploys.
    appBase: string;
    // Root-relative path of the Instructors Area post holding the instructor
    // SOP. Configured here because the post's urlId is content, and can change
    // without a code change.
    instructorSopPath: string;
  };
  // Email addresses. `from` controls sending; `contact` is only ever displayed.
  // They are separate so outbound email can be switched off without also
  // removing the address members are told to write to.
  email: {
    // Default 'From' email sender address (e.g. 'info@iliqchuan.com').
    // If left empty (''), outbound email notifications are disabled and only in-app alerts are created.
    from: string;
    // Address shown to members when something needs a human — e.g. a grading
    // payment that could not be applied. Displayed in notifications, never used
    // to send. Required: it is the only route a member is given.
    contact: string;
  };
  // Stripe API integration parameters
  stripe: {
    // Stripe API version passed to the Stripe client constructor in
    // stripe-common.ts (cast to StripeApiVersion). Pin it so request/response
    // shapes stay stable across Stripe SDK upgrades. The secret API key is not
    // here — it comes from the STRIPE_SECRET_KEY secret.
    apiVersion: string;
  };
}
