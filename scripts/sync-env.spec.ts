// @vitest-environment node
/*
 * Unit tests for scripts/sync-env.ts covering VAPID public/private key
 * cryptography checks, TypeScript AST extraction, path boundary containment,
 * pre-deploy validation, and idempotent Secret Manager push/pull workflows.
 */

import { createECDH } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assertValidProjectId,
  checkEnvironments,
  deriveVapidPublicKeyFromPrivate,
  EnvFileStatus,
  EnvSecretName,
  EnvSyncCommand,
  extractEnvironmentBooleanPath,
  extractEnvironmentStringField,
  extractEnvironmentStringPath,
  findPlaceholderLiterals,
  getEnvStatuses,
  parseArgs,
  pullEnvironments,
  pushEnvironments,
  resolveRepoFilePath,
  SecretStore,
  validateVapidPublicKey,
} from './sync-env';

const FAKE_FIREBASE_API_KEY = 'AIza' + 'FakeUnitTestKeyNotARealSecret0000000';

function generateTestVapidKeyPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const rawPriv = ecdh.getPrivateKey();
  const paddedPriv =
    rawPriv.length === 32
      ? rawPriv
      : Buffer.concat([Buffer.alloc(32 - rawPriv.length, 0), rawPriv]);
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: paddedPriv.toString('base64url'),
  };
}

function makeClientEnvSource(
  vapidPublicKey: string,
  overrides: {
    apiKey?: string;
    projectId?: string;
    appId?: string;
    useEmulator?: boolean;
  } = {},
): string {
  const apiKey = overrides.apiKey ?? FAKE_FIREBASE_API_KEY;
  const projectId = overrides.projectId ?? 'ilc-paris-class-tracker';
  const appId = overrides.appId ?? '1:1234567890:web:abcdef123456';
  const useEmulator = overrides.useEmulator ?? false;
  return `import { AppEnvironment } from './environment.types';

const firebaseConfig = {
  apiKey: '${apiKey}',
  authDomain: 'app.iliqchuan.com',
  projectId: '${projectId}',
  storageBucket: 'ilc-paris-class-tracker.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '${appId}',
  measurementId: 'G-TEST000000',
};

export const environment: AppEnvironment = {
  production: false,
  useEmulator: ${useEmulator},
  firebase: firebaseConfig,
  vapidPublicKey: '${vapidPublicKey}',
} as AppEnvironment;
`;
}

function makeFunctionsEnvSource(vapidPublicKey: string): string {
  return `import { FunctionsEnvironment } from './environment.types.js';
export const environment: FunctionsEnvironment = {
  vapidPublicKey: '${vapidPublicKey}',
  pushContactEmail: 'mailto:web-helper-team@iliqchuan.com',
} as FunctionsEnvironment;
`;
}

function createMemorySecretStore(
  initial: Partial<Record<EnvSecretName, string>> = {},
): SecretStore & { store: Partial<Record<EnvSecretName, string>>; writes: number } {
  const store: Partial<Record<EnvSecretName, string>> = { ...initial };
  let writes = 0;
  return {
    store,
    get writes() {
      return writes;
    },
    readLatestSecret(_project: string, secretName: EnvSecretName): string | null {
      return store[secretName] ?? null;
    },
    writeSecretVersion(
      _project: string,
      secretName: EnvSecretName,
      content: string,
    ): string {
      writes += 1;
      store[secretName] = content;
      return String(writes);
    },
  };
}

describe('scripts/sync-env', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilc-sync-env-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseArgs & assertValidProjectId', () => {
    it('parses commands and flags cleanly while ignoring `--` separator', () => {
      expect(
        parseArgs(['--', 'pull', '--project', 'ilc-paris-class-tracker', '--force']),
      ).toEqual({
        command: EnvSyncCommand.Pull,
        project: 'ilc-paris-class-tracker',
        force: true,
        dryRun: false,
        offline: false,
      });
    });

    it('rejects invalid GCP project IDs and path traversal attempts', () => {
      expect(() => assertValidProjectId('BAD_PROJECT; rm -rf /')).toThrow(
        /Invalid Google Cloud project ID/,
      );
      expect(assertValidProjectId('ilc-paris-class-tracker')).toBe(
        'ilc-paris-class-tracker',
      );
      expect(() => resolveRepoFilePath(tmpDir, '../outside.ts')).toThrow(
        /Security violation/,
      );
    });
  });

  describe('validateVapidPublicKey & deriveVapidPublicKeyFromPrivate', () => {
    it('accepts empty string and valid prime256v1 public keys, and derives matching public key', () => {
      const pair = generateTestVapidKeyPair();
      expect(validateVapidPublicKey('')).toBeNull();
      expect(validateVapidPublicKey(pair.publicKey)).toBeNull();
      expect(deriveVapidPublicKeyFromPrivate(pair.privateKey)).toBe(
        pair.publicKey,
      );
    });

    it('rejects Stripe publishable keys, wrong byte lengths, and off-curve 65-byte buffers', () => {
      expect(
        validateVapidPublicKey(
          'pk_test_51TpwRFIFnS8TD5ax4NEbNVSMUWvi6JAPCvNQsXzHvXuZIjbNmRLCSNKh7OsKVcAVW0G6eXeByObTaPjiOpNIriam006j1FFENS',
        ),
      ).toContain('Stripe publishable key');

      expect(validateVapidPublicKey('YOUR_VAPID_PUBLIC_KEY')).toContain(
        'expected 65 decoded bytes',
      );

      const offCurve = Buffer.alloc(65, 1);
      offCurve[0] = 0x04;
      expect(validateVapidPublicKey(offCurve.toString('base64url'))).toContain(
        'not a valid point on the NIST P-256',
      );
    });
  });

  describe('extractEnvironmentStringField & AST helpers', () => {
    it('extracts top-level and nested properties across const object references', () => {
      const pair = generateTestVapidKeyPair();
      const src = makeClientEnvSource(pair.publicKey);
      expect(
        extractEnvironmentStringField(src, 'environment.local.ts', 'vapidPublicKey'),
      ).toBe(pair.publicKey);
      expect(
        extractEnvironmentStringPath(src, 'environment.local.ts', [
          'firebase',
          'apiKey',
        ]),
      ).toBe(FAKE_FIREBASE_API_KEY);
      expect(
        extractEnvironmentBooleanPath(src, 'environment.local.ts', ['useEmulator']),
      ).toBe(false);
    });

    it('detects YOUR_*, emulator-api-key, and @example.com placeholders while ignoring comments', () => {
      const pair = generateTestVapidKeyPair();
      const cleanWithComment =
        `// Comment mentioning YOUR_API_KEY and admin@example.com\n` +
        makeClientEnvSource(pair.publicKey);
      expect(
        findPlaceholderLiterals(cleanWithComment, 'environment.local.ts'),
      ).toEqual([]);

      const repoRoot = path.resolve(__dirname, '..');
      const clientTemplate = fs.readFileSync(
        path.join(repoRoot, 'src/environments/environment.ts'),
        'utf8',
      );
      const emulatorEnv = fs.readFileSync(
        path.join(repoRoot, 'src/environments/environment.emulator.ts'),
        'utf8',
      );
      const functionsTemplate = fs.readFileSync(
        path.join(repoRoot, 'functions/src/environment/environment.template.ts'),
        'utf8',
      );

      expect(
        findPlaceholderLiterals(clientTemplate, 'environment.ts').some((m) =>
          m.includes('YOUR_API_KEY'),
        ),
      ).toBe(true);
      expect(
        findPlaceholderLiterals(emulatorEnv, 'environment.emulator.ts').some((m) =>
          m.includes('emulator-api-key'),
        ),
      ).toBe(true);
      expect(
        findPlaceholderLiterals(
          functionsTemplate,
          'environment.template.ts',
        ).some((m) => m.includes('mailto:admin@example.com')),
      ).toBe(true);
    });
  });

  describe('checkEnvironments, pushEnvironments, pullEnvironments, getEnvStatuses', () => {
    function writeLocalEnvs(clientKey: string, functionsKey: string): void {
      const clientFile = path.join(
        tmpDir,
        'src/environments/environment.local.ts',
      );
      const fnFile = path.join(
        tmpDir,
        'functions/src/environment/environment.ts',
      );
      fs.mkdirSync(path.dirname(clientFile), { recursive: true });
      fs.mkdirSync(path.dirname(fnFile), { recursive: true });
      fs.writeFileSync(clientFile, makeClientEnvSource(clientKey), 'utf8');
      fs.writeFileSync(fnFile, makeFunctionsEnvSource(functionsKey), 'utf8');
    }

    it('rejects committed template or emulator files copied into local env paths', () => {
      const repoRoot = path.resolve(__dirname, '..');
      const clientFile = path.join(
        tmpDir,
        'src/environments/environment.local.ts',
      );
      const fnFile = path.join(
        tmpDir,
        'functions/src/environment/environment.ts',
      );
      fs.mkdirSync(path.dirname(clientFile), { recursive: true });
      fs.mkdirSync(path.dirname(fnFile), { recursive: true });

      // Case 1: client copied from src/environments/environment.ts (YOUR_API_KEY)
      fs.copyFileSync(
        path.join(repoRoot, 'src/environments/environment.ts'),
        clientFile,
      );
      fs.writeFileSync(fnFile, makeFunctionsEnvSource(''), 'utf8');
      expect(() =>
        checkEnvironments({ repoRoot: tmpDir, offline: true }),
      ).toThrow(/placeholder value.*YOUR_API_KEY/);

      // Case 2: valid client, functions copied from environment.template.ts
      fs.writeFileSync(clientFile, makeClientEnvSource(''), 'utf8');
      fs.copyFileSync(
        path.join(repoRoot, 'functions/src/environment/environment.template.ts'),
        fnFile,
      );
      expect(() =>
        checkEnvironments({ repoRoot: tmpDir, offline: true }),
      ).toThrow(/placeholder value.*mailto:admin@example\.com/);

      // Case 3: client copied from environment.emulator.ts
      fs.copyFileSync(
        path.join(repoRoot, 'src/environments/environment.emulator.ts'),
        clientFile,
      );
      fs.writeFileSync(fnFile, makeFunctionsEnvSource(''), 'utf8');
      expect(() =>
        checkEnvironments({ repoRoot: tmpDir, offline: true }),
      ).toThrow(/placeholder value.*emulator-api-key/);
    });

    it('rejects useEmulator: true, malformed firebase.apiKey, or mismatched projectId', () => {
      const clientFile = path.join(
        tmpDir,
        'src/environments/environment.local.ts',
      );
      const fnFile = path.join(
        tmpDir,
        'functions/src/environment/environment.ts',
      );
      fs.mkdirSync(path.dirname(clientFile), { recursive: true });
      fs.mkdirSync(path.dirname(fnFile), { recursive: true });
      fs.writeFileSync(fnFile, makeFunctionsEnvSource(''), 'utf8');

      fs.writeFileSync(
        clientFile,
        makeClientEnvSource('', { useEmulator: true }),
        'utf8',
      );
      expect(() =>
        checkEnvironments({ repoRoot: tmpDir, offline: true }),
      ).toThrow(/`useEmulator` must be `false`/);

      fs.writeFileSync(
        clientFile,
        makeClientEnvSource('', { apiKey: 'not-a-firebase-key' }),
        'utf8',
      );
      expect(() =>
        checkEnvironments({ repoRoot: tmpDir, offline: true }),
      ).toThrow(/`firebase\.apiKey` is not a valid Firebase Web API key/);

      fs.writeFileSync(
        clientFile,
        makeClientEnvSource('', { projectId: 'other-firebase-project' }),
        'utf8',
      );
      expect(() =>
        checkEnvironments({
          repoRoot: tmpDir,
          offline: true,
          project: 'ilc-paris-class-tracker',
        }),
      ).toThrow(/does not match target project/);
    });

    it('fails online check when local env files drift from Cloud Secret Manager', () => {
      const pair = generateTestVapidKeyPair();
      writeLocalEnvs(pair.publicKey, pair.publicKey);
      const clientSource = fs.readFileSync(
        path.join(tmpDir, 'src/environments/environment.local.ts'),
        'utf8',
      );
      const fnSource = fs.readFileSync(
        path.join(tmpDir, 'functions/src/environment/environment.ts'),
        'utf8',
      );
      const secretStore = createMemorySecretStore({
        [EnvSecretName.VapidPrivateKey]: pair.privateKey,
        [EnvSecretName.Client]: clientSource + '\n// remote canonical change\n',
        [EnvSecretName.Functions]: fnSource,
      });

      expect(() =>
        checkEnvironments({
          repoRoot: tmpDir,
          offline: false,
          project: 'ilc-paris-class-tracker',
          secretStore,
        }),
      ).toThrow(/differs from Cloud Secret Manager 'CLIENT_ENVIRONMENT_LOCAL_TS'/);
    });

    it('fails check when client and server vapidPublicKey differ', () => {
      const pair1 = generateTestVapidKeyPair();
      const pair2 = generateTestVapidKeyPair();
      writeLocalEnvs(pair1.publicKey, pair2.publicKey);

      expect(() =>
        checkEnvironments({ repoRoot: tmpDir, offline: true }),
      ).toThrow(/vapidPublicKey mismatch/);
    });

    it('fails check when local vapidPublicKey disagrees with Cloud Secret VAPID_PRIVATE_KEY', () => {
      const pair1 = generateTestVapidKeyPair();
      const pair2 = generateTestVapidKeyPair();
      writeLocalEnvs(pair1.publicKey, pair1.publicKey);
      const secretStore = createMemorySecretStore({
        [EnvSecretName.VapidPrivateKey]: pair2.privateKey,
      });

      expect(() =>
        checkEnvironments({
          repoRoot: tmpDir,
          offline: false,
          project: 'ilc-paris-class-tracker',
          secretStore,
        }),
      ).toThrow(/does not match the public key derived from Cloud Secret/);
    });

    it('pushes idempotently and pulls safely into a clean worktree with --force protection', () => {
      const pair = generateTestVapidKeyPair();
      writeLocalEnvs(pair.publicKey, pair.publicKey);
      const secretStore = createMemorySecretStore({
        [EnvSecretName.VapidPrivateKey]: pair.privateKey,
      });

      // Initial push uploads both files.
      const firstPush = pushEnvironments({
        repoRoot: tmpDir,
        project: 'ilc-paris-class-tracker',
        dryRun: false,
        secretStore,
      });
      expect(firstPush.every((r) => r.uploaded)).toBe(true);
      expect(secretStore.writes).toBe(2);

      // Second push is a no-op because remote matches local.
      const secondPush = pushEnvironments({
        repoRoot: tmpDir,
        project: 'ilc-paris-class-tracker',
        dryRun: false,
        secretStore,
      });
      expect(secondPush.every((r) => !r.uploaded)).toBe(true);
      expect(secretStore.writes).toBe(2);

      // Status reports InSync for both targets.
      const statuses = getEnvStatuses({
        repoRoot: tmpDir,
        project: 'ilc-paris-class-tracker',
        secretStore,
      });
      expect(statuses.map((s) => s.status)).toEqual([
        EnvFileStatus.InSync,
        EnvFileStatus.InSync,
      ]);

      // Pull into a brand-new worktree writes both files.
      const freshWorktree = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ilc-fresh-wt-'),
      );
      try {
        const pulled = pullEnvironments({
          repoRoot: freshWorktree,
          project: 'ilc-paris-class-tracker',
          force: false,
          dryRun: false,
          secretStore,
        });
        expect(pulled.every((r) => r.written)).toBe(true);

        // Local modification without --force refuses to overwrite.
        const clientFile = path.join(
          freshWorktree,
          'src/environments/environment.local.ts',
        );
        fs.writeFileSync(clientFile, makeClientEnvSource(''), 'utf8');
        expect(() =>
          pullEnvironments({
            repoRoot: freshWorktree,
            project: 'ilc-paris-class-tracker',
            force: false,
            dryRun: false,
            secretStore,
          }),
        ).toThrow(/differs from Secret Manager/);

        // With --force, restores the canonical remote copy cleanly.
        const forcedPull = pullEnvironments({
          repoRoot: freshWorktree,
          project: 'ilc-paris-class-tracker',
          force: true,
          dryRun: false,
          secretStore,
        });
        expect(forcedPull[0].written).toBe(true);
        expect(forcedPull[1].written).toBe(false);
      } finally {
        fs.rmSync(freshWorktree, { recursive: true, force: true });
      }
    });
  });
});
