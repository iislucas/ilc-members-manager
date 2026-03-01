/**
 * Fetch password-protected Squarespace blog content programmatically.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/experiments/fetch-protected-blog.ts
 *
 * ## How Squarespace password protection works:
 *
 * Squarespace protects collections (e.g. blogs) with a password via a lock
 * screen. The Squarespace slides JS uses this flow to unlock:
 *
 * 1. GET the protected page URL → receive `crumb` cookie (CSRF token),
 *    and extract the collection ID from `<body id="collection-<ID>">`.
 * 2. POST to `{API_ROOT}auth/visitor/collection` with JSON body:
 *    `{ "password": "<pw>", "collectionId": "<collection-id>" }`
 *    Include the crumb cookie, and set the crumb as a header.
 * 3. The POST response sets session cookies authenticating future requests.
 * 4. GET the page with `?format=json` using those session cookies.
 *
 * This was reverse-engineered from Squarespace's slides JS bundle:
 *   squarespace-slide-rendering-slices-password → _authenticate function
 */

import axios from 'axios';

// ---------- Configuration ----------
const SQUARESPACE_BASE_URL = 'https://lute-denim-99n2.squarespace.com';
const PROTECTED_PAGE_PATH = '/test-blog-1';
const PASSWORD = 'test';

// ---------- Helpers ----------

/** Extract cookie name=value pairs from Set-Cookie headers. */
function parseCookies(setCookieHeaders: string[]): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of setCookieHeaders) {
    const nameValue = header.split(';')[0].trim();
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) {
      const name = nameValue.substring(0, eqIdx);
      cookies.set(name, nameValue);
    }
  }
  return cookies;
}

/** Convert cookie map to a Cookie header string. */
function cookieHeader(cookies: Map<string, string>): string {
  return Array.from(cookies.values()).join('; ');
}

/** Get the value of a named cookie from the map. */
function cookieValue(cookies: Map<string, string>, name: string): string {
  const cookie = cookies.get(name);
  if (!cookie) return '';
  return cookie.split('=').slice(1).join('=');
}

// ---------- Main ----------
async function main(): Promise<void> {
  console.log('=== Squarespace Protected Blog Fetcher ===\n');

  // ── Step 1: GET the protected page ──
  // This gives us:
  //   - crumb cookie (CSRF token)
  //   - collection ID from <body id="collection-XXXXX">
  console.log('Step 1: GET the protected page to extract crumb + collectionId...');
  const initResponse = await axios.get(
    `${SQUARESPACE_BASE_URL}${PROTECTED_PAGE_PATH}`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      validateStatus: () => true,
    }
  );

  console.log(`  Response status: ${initResponse.status}`);

  const cookies = parseCookies(initResponse.headers['set-cookie'] || []);
  const crumb = cookieValue(cookies, 'crumb');
  if (!crumb) {
    throw new Error('No crumb cookie received from initial GET');
  }
  console.log(`  ✓ Crumb: ${crumb}`);

  // Extract collection ID from <body id="collection-XXXXX">
  const html = initResponse.data as string;
  const collectionMatch = html.match(/id="collection-([^"]+)"/);
  if (!collectionMatch) {
    throw new Error(
      'Could not find collection ID in page HTML. Is the page password-protected?'
    );
  }
  const collectionId = collectionMatch[1];
  console.log(`  ✓ Collection ID: ${collectionId}`);
  console.log(`  ✓ Cookies: ${Array.from(cookies.keys()).join(', ')}\n`);

  // ── Step 2: POST to unlock the collection ──
  // Endpoint: /api/auth/visitor/collection  (from Squarespace.API_ROOT)
  // Body: { password: "xxx", collectionId: "xxx" }
  console.log('Step 2: POST to /api/auth/visitor/collection to unlock...');

  const unlockUrl = `${SQUARESPACE_BASE_URL}/api/auth/visitor/collection`;
  const unlockBody = {
    password: PASSWORD,
    collectionId: collectionId,
  };

  console.log(`  POST URL: ${unlockUrl}`);
  console.log(`  POST body: ${JSON.stringify(unlockBody)}`);

  const unlockResponse = await axios.post(unlockUrl, unlockBody, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(cookies),
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Origin: SQUARESPACE_BASE_URL,
      Referer: `${SQUARESPACE_BASE_URL}${PROTECTED_PAGE_PATH}`,
      // Squarespace uses the crumb as a CSRF token header
      'X-Csrf-Token': crumb,
    },
    validateStatus: () => true,
    maxRedirects: 0,
  });

  console.log(`  Response status: ${unlockResponse.status}`);

  // Merge new cookies from unlock response
  const unlockCookies = parseCookies(
    unlockResponse.headers['set-cookie'] || []
  );
  for (const [name, value] of unlockCookies) {
    cookies.set(name, value);
  }
  console.log(
    `  New cookies from POST: ${Array.from(unlockCookies.keys()).join(', ') || 'none'}`
  );
  console.log(`  Total cookies: ${cookies.size} → ${Array.from(cookies.keys()).join(', ')}`);

  if (unlockResponse.status >= 400) {
    console.log(`  ✗ Unlock failed!`);
    const body =
      typeof unlockResponse.data === 'string'
        ? unlockResponse.data.substring(0, 300)
        : JSON.stringify(unlockResponse.data).substring(0, 300);
    console.log(`  Response body: ${body}`);
    // Don't exit - try the JSON request anyway in case it's a false negative
  } else {
    console.log(`  ✓ Unlock succeeded!`);
  }

  console.log('');

  // ── Step 3: GET the JSON data ──
  console.log('Step 3: Fetching protected blog content as JSON...');
  const jsonUrl = `${SQUARESPACE_BASE_URL}${PROTECTED_PAGE_PATH}?format=json`;
  console.log(`  GET URL: ${jsonUrl}`);

  const jsonResponse = await axios.get(jsonUrl, {
    headers: {
      Cookie: cookieHeader(cookies),
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'application/json',
    },
    validateStatus: () => true,
  });

  console.log(`  Response status: ${jsonResponse.status}`);
  console.log(
    `  Content-Type: ${jsonResponse.headers['content-type'] || 'unknown'}\n`
  );

  if (jsonResponse.status === 200) {
    let data: Record<string, unknown>;
    const ct = jsonResponse.headers['content-type'] || '';

    if (ct.includes('json')) {
      data = jsonResponse.data as Record<string, unknown>;
    } else {
      try {
        data =
          typeof jsonResponse.data === 'string'
            ? JSON.parse(jsonResponse.data)
            : (jsonResponse.data as Record<string, unknown>);
      } catch {
        console.log('  ✗ Response is not JSON.');
        const preview =
          typeof jsonResponse.data === 'string'
            ? jsonResponse.data.substring(0, 500)
            : JSON.stringify(jsonResponse.data).substring(0, 500);
        console.log(`  Body preview: ${preview}`);
        return;
      }
    }

    console.log('  ✓ Successfully fetched protected JSON content!\n');
    displayBlogSummary(data);

    // ── Step 4: Demonstrate cookie reuse ──
    console.log(
      '\n--- Cookie Reuse Demo: subsequent requests without re-authenticating ---\n'
    );
    console.log(
      'The following cookies can be stored and reused for ~4 hours:'
    );
    for (const [name, value] of cookies) {
      console.log(`  ${value}`);
    }
  } else {
    console.log(`  ✗ Failed with status ${jsonResponse.status}`);
    const body =
      typeof jsonResponse.data === 'string'
        ? jsonResponse.data.substring(0, 500)
        : JSON.stringify(jsonResponse.data).substring(0, 500);
    console.log(`  Body: ${body}`);
  }
}

/**
 * Display a summary of the fetched blog data and save the full JSON.
 */
function displayBlogSummary(data: Record<string, unknown>): void {
  console.log('=== Blog Content Summary ===\n');
  console.log('Top-level keys:', Object.keys(data));

  const collection = data['collection'] as
    | Record<string, unknown>
    | undefined;
  if (collection) {
    console.log('\nCollection:');
    console.log(`  Title: ${collection['title']}`);
    console.log(`  Type: ${collection['typeName']}`);
    console.log(`  ID: ${collection['id']}`);
  }

  const items = data['items'] as Array<Record<string, unknown>> | undefined;
  if (items && items.length > 0) {
    console.log(`\nBlog Posts: ${items.length} found`);
    for (const item of items) {
      console.log(`\n  📝 "${item['title']}"`);
      console.log(`     URL: ${item['fullUrl']}`);
      console.log(`     ID: ${item['id']}`);
      if (item['publishOn']) {
        console.log(
          `     Published: ${new Date(item['publishOn'] as number).toISOString()}`
        );
      }
      const categories = item['categories'] as string[] | undefined;
      if (categories && categories.length > 0) {
        console.log(`     Categories: ${categories.join(', ')}`);
      }
      const excerpt = item['excerpt'] as string | undefined;
      if (excerpt) {
        const cleanExcerpt = excerpt.replace(/<[^>]*>/g, '').trim();
        console.log(
          `     Excerpt: ${cleanExcerpt.substring(0, 120)}${cleanExcerpt.length > 120 ? '...' : ''}`
        );
      }
    }
  } else {
    console.log('\nNo blog posts found in the response.');
  }

  // Save full JSON
  const fs = require('fs');
  const path = require('path');
  const outputPath = path.join(__dirname, 'blog-content-output.json');
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\n📁 Full JSON saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message || error);
  process.exit(1);
});
