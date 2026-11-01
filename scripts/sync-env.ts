/*
 * Synchronize git-ignored local environment configuration files with Google
 * Cloud Secret Manager and validate client/server Web Push (VAPID) invariants
 * before deployment.
 *
 * Managed environment files <-> Cloud Secret Manager secrets:
 *   - src/environments/environment.local.ts   <-> CLIENT_ENVIRONMENT_LOCAL_TS
 *   - functions/src/environment/environment.ts <-> FUNCTIONS_ENVIRONMENT_TS
 *
 * Pre-deploy validation (`check`, also run automatically before `push` and all
 * `pnpm deploy*` commands):
 *   1. Verifies both local environment files exist and export `environment`.
 *   2. Extracts `vapidPublicKey` via TypeScript AST parsing (no eval/vm) and
 *      asserts client and server values are identical.
 *   3. When non-empty, verifies `vapidPublicKey` is a cryptographically valid
 *      65-byte uncompressed NIST P-256 public key (87 base64url chars starting
 *      with 'B', valid point on prime256v1).
 *   4. Unless `--offline` is passed, reads `VAPID_PRIVATE_KEY` from Cloud
 *      Secret Manager, derives its P-256 public key, and verifies it matches
 *      `vapidPublicKey`.
 *
 * Usage (requires an authenticated `gcloud` CLI for cloud commands):
 *   pnpm env:check                       # Validate local env files + VAPID secret match
 *   pnpm env:check -- --offline          # Validate local env files without calling gcloud
 *   pnpm env:status                      # Compare local env files against Secret Manager
 *   pnpm env:push                        # Validate & upload changed env files to Secret Manager
 *   pnpm env:push -- --dry-run           # Preview push without writing to Secret Manager
 *   pnpm env:pull                        # Download missing/matching env files from Secret Manager
 *   pnpm env:pull -- --force             # Overwrite differing local env files from Secret Manager
 */

import { execFileSync } from 'node:child_process';
import { createECDH, createHash, ECDH } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

export enum EnvSyncCommand {
  Check = 'check',
  Status = 'status',
  Push = 'push',
  Pull = 'pull',
}

export enum EnvSecretName {
  Client = 'CLIENT_ENVIRONMENT_LOCAL_TS',
  Functions = 'FUNCTIONS_ENVIRONMENT_TS',
  VapidPrivateKey = 'VAPID_PRIVATE_KEY',
}

export enum EnvFileStatus {
  InSync = 'in_sync',
  LocalMissing = 'local_missing',
  RemoteMissing = 'remote_missing',
  BothMissing = 'both_missing',
  Modified = 'modified',
}

export interface ManagedEnvTarget {
  label: string;
  relativePath: string;
  secretName: EnvSecretName;
}

export const MANAGED_ENV_TARGETS: readonly ManagedEnvTarget[] = [
  {
    label: 'Client environment',
    relativePath: 'src/environments/environment.local.ts',
    secretName: EnvSecretName.Client,
  },
  {
    label: 'Functions environment',
    relativePath: 'functions/src/environment/environment.ts',
    secretName: EnvSecretName.Functions,
  },
];

export interface CliOptions {
  command: EnvSyncCommand;
  project: string;
  force: boolean;
  dryRun: boolean;
  offline: boolean;
}

// Abstraction over Google Cloud Secret Manager operations for deterministic unit testing.
export interface SecretStore {
  readLatestSecret(project: string, secretName: EnvSecretName): string | null;
  writeSecretVersion(
    project: string,
    secretName: EnvSecretName,
    content: string,
  ): string;
}

export interface CheckResult {
  vapidPublicKey: string;
  verifiedAgainstCloudSecret: boolean;
}

const GCP_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,29}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

// Parses CLI arguments into a typed options object.
export function parseArgs(argv: string[]): CliOptions {
  let command: EnvSyncCommand | null = null;
  let project = '';
  let force = false;
  let dryRun = false;
  let offline = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case EnvSyncCommand.Check:
      case EnvSyncCommand.Status:
      case EnvSyncCommand.Push:
      case EnvSyncCommand.Pull:
        if (command) {
          throw new Error(`Multiple commands specified: '${command}' and '${arg}'.`);
        }
        command = arg;
        break;
      case '--project':
        project = argv[++i] ?? '';
        break;
      case '--force':
        force = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--offline':
        offline = true;
        break;
      default:
        throw new Error(
          `Unknown argument: '${arg}'. Expected command (check|status|push|pull) and optional flags (--project, --force, --dry-run, --offline).`,
        );
    }
  }

  if (!command) {
    throw new Error(
      'Missing command. Usage: sync-env.ts <check|status|push|pull> [--project <id>] [--force] [--dry-run] [--offline]',
    );
  }

  return { command, project, force, dryRun, offline };
}

// Validates a GCP project ID against Google Cloud's strict identifier syntax.
export function assertValidProjectId(project: string): string {
  const trimmed = project.trim();
  if (!GCP_PROJECT_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid Google Cloud project ID '${project}'. Expected 6-30 lowercase letters, digits, or hyphens.`,
    );
  }
  return trimmed;
}

// Resolves a relative path inside `repoRoot` and enforces directory boundary containment.
export function resolveRepoFilePath(repoRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedTarget = path.resolve(resolvedRoot, relativePath);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(
      `Security violation: path '${relativePath}' resolves outside repository root '${resolvedRoot}'.`,
    );
  }
  return resolvedTarget;
}

// Returns a short 12-character hex SHA-256 digest for safe human-readable status comparisons.
export function shortSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 12);
}

// Validates that `key` is a base64url-encoded 65-byte uncompressed NIST P-256 public key
// (0x04 || X || Y) whose point lies on the prime256v1 curve. Returns null if valid, or a
// descriptive error string if invalid.
export function validateVapidPublicKey(key: string): string | null {
  if (key === '') {
    return null;
  }
  if (key.startsWith('pk_test_') || key.startsWith('pk_live_')) {
    return 'appears to be a Stripe publishable key (`pk_...`), not a Web Push VAPID public key';
  }
  if (!BASE64URL_PATTERN.test(key)) {
    return 'contains characters outside the base64url alphabet (A-Z, a-z, 0-9, -, _)';
  }
  const raw = Buffer.from(key, 'base64url');
  if (raw.length !== 65 || raw[0] !== 0x04) {
    return `expected 65 decoded bytes starting with 0x04 (87 base64url chars starting with 'B'), got ${raw.length} bytes starting with 0x${(raw[0] ?? 0).toString(16).padStart(2, '0')} (${key.length} chars)`;
  }
  try {
    // OpenSSL verifies that (X, Y) lies on prime256v1 during point conversion.
    ECDH.convertKey(raw, 'prime256v1', undefined, undefined, 'compressed');
  } catch {
    return '65-byte key is not a valid point on the NIST P-256 (prime256v1) curve';
  }
  return null;
}

// Derives the base64url uncompressed 65-byte P-256 public key from a base64url 32-byte VAPID private key.
export function deriveVapidPublicKeyFromPrivate(privateKeyBase64Url: string): string {
  const trimmed = privateKeyBase64Url.trim();
  if (!trimmed || !BASE64URL_PATTERN.test(trimmed)) {
    throw new Error('VAPID_PRIVATE_KEY is empty or contains non-base64url characters.');
  }
  const rawPriv = Buffer.from(trimmed, 'base64url');
  if (rawPriv.length < 31 || rawPriv.length > 32) {
    throw new Error(
      `Invalid VAPID_PRIVATE_KEY length: expected 32 decoded bytes, got ${rawPriv.length}.`,
    );
  }
  const paddedPriv =
    rawPriv.length === 32
      ? rawPriv
      : Buffer.concat([Buffer.alloc(32 - rawPriv.length, 0), rawPriv]);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(paddedPriv);
  return ecdh.getPublicKey().toString('base64url');
}

// Extracts a string literal property from `export const environment = { ... }` in a TypeScript
// source string using the TypeScript AST parser (without executing any code).
export function extractEnvironmentStringField(
  sourceText: string,
  fileLabel: string,
  fieldName: string,
): string {
  const sourceFile = ts.createSourceFile(
    fileLabel,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let envObject: ts.ObjectLiteralExpression | undefined;

  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = stmt.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) continue;

    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === 'environment' &&
        decl.initializer
      ) {
        let init = decl.initializer;
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) {
          init = init.expression;
        }
        if (ts.isObjectLiteralExpression(init)) {
          envObject = init;
        }
      }
    }
  }

  if (!envObject) {
    throw new Error(
      `${fileLabel}: could not find \`export const environment = { ... }\`.`,
    );
  }

  for (const prop of envObject.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const propName =
      ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (propName !== fieldName) continue;

    let val = prop.initializer;
    while (ts.isAsExpression(val) || ts.isSatisfiesExpression(val)) {
      val = val.expression;
    }
    if (ts.isStringLiteral(val) || ts.isNoSubstitutionTemplateLiteral(val)) {
      return val.text;
    }
    throw new Error(
      `${fileLabel}: expected \`environment.${fieldName}\` to be a string literal.`,
    );
  }

  throw new Error(
    `${fileLabel}: missing \`${fieldName}\` property on \`environment\`.`,
  );
}

// Validates both local environment files and verifies that `vapidPublicKey` is identical,
// cryptographically valid, and (when online) matches `VAPID_PRIVATE_KEY` in Cloud Secret Manager.
export function checkEnvironments(params: {
  repoRoot: string;
  offline: boolean;
  project?: string;
  secretStore?: SecretStore;
}): CheckResult {
  const clientTarget = MANAGED_ENV_TARGETS[0];
  const functionsTarget = MANAGED_ENV_TARGETS[1];

  const clientPath = resolveRepoFilePath(params.repoRoot, clientTarget.relativePath);
  const functionsPath = resolveRepoFilePath(
    params.repoRoot,
    functionsTarget.relativePath,
  );

  const missing: string[] = [];
  if (!fs.existsSync(clientPath)) missing.push(clientTarget.relativePath);
  if (!fs.existsSync(functionsPath)) missing.push(functionsTarget.relativePath);
  if (missing.length > 0) {
    throw new Error(
      `Missing local environment file(s): ${missing.join(', ')}. Run \`pnpm env:pull\` to fetch from Cloud Secret Manager.`,
    );
  }

  const clientSource = fs.readFileSync(clientPath, 'utf8');
  const functionsSource = fs.readFileSync(functionsPath, 'utf8');

  const clientVapidKey = extractEnvironmentStringField(
    clientSource,
    clientTarget.relativePath,
    'vapidPublicKey',
  );
  const functionsVapidKey = extractEnvironmentStringField(
    functionsSource,
    functionsTarget.relativePath,
    'vapidPublicKey',
  );

  const clientErr = validateVapidPublicKey(clientVapidKey);
  if (clientErr) {
    throw new Error(
      `Invalid vapidPublicKey in ${clientTarget.relativePath}: ${clientErr}.`,
    );
  }

  const functionsErr = validateVapidPublicKey(functionsVapidKey);
  if (functionsErr) {
    throw new Error(
      `Invalid vapidPublicKey in ${functionsTarget.relativePath}: ${functionsErr}.`,
    );
  }

  if (clientVapidKey !== functionsVapidKey) {
    throw new Error(
      `vapidPublicKey mismatch between ${clientTarget.relativePath} (${clientVapidKey.length} chars) and ${functionsTarget.relativePath} (${functionsVapidKey.length} chars). Both files must carry the exact same key (or both be '').`,
    );
  }

  let verifiedAgainstCloudSecret = false;
  if (!params.offline && clientVapidKey !== '') {
    if (!params.project || !params.secretStore) {
      throw new Error(
        'Project ID and SecretStore are required for online VAPID secret verification (or pass --offline).',
      );
    }
    const validProject = assertValidProjectId(params.project);
    const privateKey = params.secretStore.readLatestSecret(
      validProject,
      EnvSecretName.VapidPrivateKey,
    );
    if (!privateKey) {
      throw new Error(
        `vapidPublicKey is configured locally, but secret '${EnvSecretName.VapidPrivateKey}' was not found in Cloud Secret Manager (project '${validProject}'). Set it via \`firebase functions:secrets:set VAPID_PRIVATE_KEY\`.`,
      );
    }
    const derivedPublicKey = deriveVapidPublicKeyFromPrivate(privateKey);
    if (derivedPublicKey !== clientVapidKey) {
      throw new Error(
        `vapidPublicKey in local environment files does not match the public key derived from Cloud Secret '${EnvSecretName.VapidPrivateKey}' (expected '${derivedPublicKey}').`,
      );
    }
    verifiedAgainstCloudSecret = true;
  }

  return {
    vapidPublicKey: clientVapidKey,
    verifiedAgainstCloudSecret,
  };
}

// Compares each managed environment file locally against Cloud Secret Manager without modifying anything.
export function getEnvStatuses(params: {
  repoRoot: string;
  project: string;
  secretStore: SecretStore;
}): {
  target: ManagedEnvTarget;
  status: EnvFileStatus;
  localHash: string | null;
  remoteHash: string | null;
}[] {
  const validProject = assertValidProjectId(params.project);
  return MANAGED_ENV_TARGETS.map((target) => {
    const filePath = resolveRepoFilePath(params.repoRoot, target.relativePath);
    const localContent = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : null;
    const remoteContent = params.secretStore.readLatestSecret(
      validProject,
      target.secretName,
    );

    const localHash = localContent !== null ? shortSha256(localContent) : null;
    const remoteHash = remoteContent !== null ? shortSha256(remoteContent) : null;

    let status: EnvFileStatus;
    if (localContent === null && remoteContent === null) {
      status = EnvFileStatus.BothMissing;
    } else if (localContent === null) {
      status = EnvFileStatus.LocalMissing;
    } else if (remoteContent === null) {
      status = EnvFileStatus.RemoteMissing;
    } else if (localContent === remoteContent) {
      status = EnvFileStatus.InSync;
    } else {
      status = EnvFileStatus.Modified;
    }

    return { target, status, localHash, remoteHash };
  });
}

// Validates local environment files and uploads any changed files to Cloud Secret Manager.
export function pushEnvironments(params: {
  repoRoot: string;
  project: string;
  dryRun: boolean;
  secretStore: SecretStore;
}): { target: ManagedEnvTarget; uploaded: boolean; version?: string }[] {
  const validProject = assertValidProjectId(params.project);

  // Fail closed: never push mismatched or invalid environment files to Cloud Secret Manager.
  checkEnvironments({
    repoRoot: params.repoRoot,
    offline: false,
    project: validProject,
    secretStore: params.secretStore,
  });

  return MANAGED_ENV_TARGETS.map((target) => {
    const filePath = resolveRepoFilePath(params.repoRoot, target.relativePath);
    const localContent = fs.readFileSync(filePath, 'utf8');
    const remoteContent = params.secretStore.readLatestSecret(
      validProject,
      target.secretName,
    );

    if (remoteContent !== null && remoteContent === localContent) {
      return { target, uploaded: false };
    }

    if (params.dryRun) {
      return { target, uploaded: true, version: 'dry-run' };
    }

    const version = params.secretStore.writeSecretVersion(
      validProject,
      target.secretName,
      localContent,
    );
    return { target, uploaded: true, version };
  });
}

// Downloads managed environment files from Cloud Secret Manager into the local checkout/worktree.
export function pullEnvironments(params: {
  repoRoot: string;
  project: string;
  force: boolean;
  dryRun: boolean;
  secretStore: SecretStore;
}): { target: ManagedEnvTarget; written: boolean }[] {
  const validProject = assertValidProjectId(params.project);

  // First fetch all remote secrets and check for overwrite conflicts before touching disk.
  const fetched = MANAGED_ENV_TARGETS.map((target) => {
    const remoteContent = params.secretStore.readLatestSecret(
      validProject,
      target.secretName,
    );
    if (remoteContent === null) {
      throw new Error(
        `Secret '${target.secretName}' does not exist in project '${validProject}'. Run \`pnpm env:push\` from a configured checkout first.`,
      );
    }
    const filePath = resolveRepoFilePath(params.repoRoot, target.relativePath);
    const localContent = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : null;

    if (
      localContent !== null &&
      localContent !== remoteContent &&
      !params.force
    ) {
      throw new Error(
        `Local file '${target.relativePath}' differs from Secret Manager (${target.secretName}). Re-run with \`--force\` to overwrite local changes, or run \`pnpm env:status\` to inspect.`,
      );
    }

    return {
      target,
      filePath,
      remoteContent,
      needsWrite: localContent !== remoteContent,
    };
  });

  const results = fetched.map((item) => {
    if (!item.needsWrite) {
      return { target: item.target, written: false };
    }
    if (!params.dryRun) {
      fs.mkdirSync(path.dirname(item.filePath), { recursive: true });
      fs.writeFileSync(item.filePath, item.remoteContent, {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
    return { target: item.target, written: true };
  });

  if (!params.dryRun) {
    checkEnvironments({
      repoRoot: params.repoRoot,
      offline: true,
    });
  }

  return results;
}

// Reads the default project ID from `.firebaserc` at `repoRoot`, if present.
function projectFromFirebaseRc(repoRoot: string): string | undefined {
  try {
    const rcPath = resolveRepoFilePath(repoRoot, '.firebaserc');
    const parsed = JSON.parse(fs.readFileSync(rcPath, 'utf8')) as {
      projects?: { default?: string };
    };
    return parsed.projects?.default;
  } catch {
    return undefined;
  }
}

// Reads the active project ID from `gcloud config`, if configured.
function projectFromGcloud(): string | undefined {
  try {
    const out = execFileSync('gcloud', ['config', 'get-value', 'project'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out && out !== '(unset)' ? out : undefined;
  } catch {
    return undefined;
  }
}

// Resolves the target GCP project ID from CLI flag, environment variables, `.firebaserc`, or gcloud.
function resolveProject(explicitProject: string, repoRoot: string): string {
  const candidate =
    explicitProject ||
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['GCLOUD_PROJECT'] ||
    projectFromFirebaseRc(repoRoot) ||
    projectFromGcloud();

  if (!candidate) {
    throw new Error(
      'Could not determine Google Cloud project ID. Pass --project <id> or configure `.firebaserc`.',
    );
  }
  return assertValidProjectId(candidate);
}

// Production SecretStore backed by the authenticated `gcloud secrets` CLI.
// Uses `execFileSync` with fixed argument arrays (no shell) and passes secret
// payloads via stdin (`--data-file=-`) so contents never touch `/tmp` or process args.
function createGcloudSecretStore(): SecretStore {
  return {
    readLatestSecret(project: string, secretName: EnvSecretName): string | null {
      const validProject = assertValidProjectId(project);
      try {
        return execFileSync(
          'gcloud',
          [
            'secrets',
            'versions',
            'access',
            'latest',
            `--secret=${secretName}`,
            `--project=${validProject}`,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (err: unknown) {
        const stderr = String((err as { stderr?: unknown })?.stderr ?? '');
        if (stderr.includes('NOT_FOUND') || stderr.includes('not found')) {
          return null;
        }
        throw new Error(
          `Failed to read secret '${secretName}' from project '${validProject}'. Ensure \`gcloud auth login\` is active and Secret Manager permissions are granted.`,
        );
      }
    },

    writeSecretVersion(
      project: string,
      secretName: EnvSecretName,
      content: string,
    ): string {
      const validProject = assertValidProjectId(project);

      // Ensure the secret container exists first.
      let exists = true;
      try {
        execFileSync(
          'gcloud',
          [
            'secrets',
            'describe',
            secretName,
            `--project=${validProject}`,
            '--format=value(name)',
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (err: unknown) {
        const stderr = String((err as { stderr?: unknown })?.stderr ?? '');
        if (stderr.includes('NOT_FOUND') || stderr.includes('not found')) {
          exists = false;
        } else {
          throw new Error(
            `Failed to inspect secret '${secretName}' in project '${validProject}'.`,
          );
        }
      }

      if (!exists) {
        execFileSync(
          'gcloud',
          [
            'secrets',
            'create',
            secretName,
            '--replication-policy=automatic',
            `--project=${validProject}`,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      }

      const out = execFileSync(
        'gcloud',
        [
          'secrets',
          'versions',
          'add',
          secretName,
          '--data-file=-',
          `--project=${validProject}`,
          '--format=value(name)',
        ],
        {
          input: Buffer.from(content, 'utf8'),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ).trim();

      const segments = out.split('/');
      return segments[segments.length - 1] || out;
    },
  };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const secretStore = createGcloudSecretStore();

  switch (opts.command) {
    case EnvSyncCommand.Check: {
      const project = opts.offline ? undefined : resolveProject(opts.project, repoRoot);
      const res = checkEnvironments({
        repoRoot,
        offline: opts.offline,
        project,
        secretStore,
      });
      if (res.vapidPublicKey === '') {
        console.log('Environment check passed: Web Push is disabled (`vapidPublicKey` is empty in both files).');
      } else {
        const secretNote = res.verifiedAgainstCloudSecret
          ? ` and matches Cloud Secret ${EnvSecretName.VapidPrivateKey}`
          : ' (offline check)';
        console.log(
          `Environment check passed: client & server vapidPublicKey match, valid P-256 point${secretNote}.`,
        );
      }
      break;
    }

    case EnvSyncCommand.Status: {
      const project = resolveProject(opts.project, repoRoot);
      const statuses = getEnvStatuses({ repoRoot, project, secretStore });
      console.log(`Environment sync status (project: ${project}):`);
      for (const s of statuses) {
        console.log(
          `  - ${s.target.relativePath} <-> ${s.target.secretName}: ${s.status} (local=${s.localHash ?? 'none'}, remote=${s.remoteHash ?? 'none'})`,
        );
      }
      const checkRes = checkEnvironments({
        repoRoot,
        offline: false,
        project,
        secretStore,
      });
      console.log(
        checkRes.vapidPublicKey
          ? `  - VAPID check: valid & matched against ${EnvSecretName.VapidPrivateKey}`
          : '  - VAPID check: disabled (empty in both files)',
      );
      break;
    }

    case EnvSyncCommand.Push: {
      const project = resolveProject(opts.project, repoRoot);
      const results = pushEnvironments({
        repoRoot,
        project,
        dryRun: opts.dryRun,
        secretStore,
      });
      for (const r of results) {
        if (!r.uploaded) {
          console.log(`Unchanged: ${r.target.relativePath} (${r.target.secretName})`);
        } else if (opts.dryRun) {
          console.log(`[dry-run] Would upload ${r.target.relativePath} -> ${r.target.secretName}`);
        } else {
          console.log(
            `Uploaded ${r.target.relativePath} -> ${r.target.secretName} (version ${r.version})`,
          );
        }
      }
      break;
    }

    case EnvSyncCommand.Pull: {
      const project = resolveProject(opts.project, repoRoot);
      const results = pullEnvironments({
        repoRoot,
        project,
        force: opts.force,
        dryRun: opts.dryRun,
        secretStore,
      });
      for (const r of results) {
        if (!r.written) {
          console.log(`Up to date: ${r.target.relativePath}`);
        } else if (opts.dryRun) {
          console.log(`[dry-run] Would write ${r.target.relativePath} from ${r.target.secretName}`);
        } else {
          console.log(`Wrote ${r.target.relativePath} from ${r.target.secretName}`);
        }
      }
      break;
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Environment check/sync failed: ${message}`);
    process.exit(1);
  }
}
