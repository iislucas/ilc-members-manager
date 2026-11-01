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
  extractEnvironmentStringField,
  getEnvStatuses,
  parseArgs,
  pullEnvironments,
  pushEnvironments,
  resolveRepoFilePath,
  SecretStore,
  validateVapidPublicKey,
} from './sync-env';

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

function makeClientEnvSource(vapidPublicKey: string): string {
  return `import { AppEnvironment } from './environment.types';
export const environment: AppEnvironment = {
  production: false,
  useEmulator: false,
  vapidPublicKey: '${vapidPublicKey}',
} as AppEnvironment;
`;
}

function makeFunctionsEnvSource(vapidPublicKey: string): string {
  return `import { FunctionsEnvironment } from './environment.types.js';
export const environment: FunctionsEnvironment = {
  vapidPublicKey: '${vapidPublicKey}',
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

  describe('extractEnvironmentStringField', () => {
    it('extracts vapidPublicKey from exported environment object literals with TS casts', () => {
      const pair = generateTestVapidKeyPair();
      const src = makeClientEnvSource(pair.publicKey);
      expect(
        extractEnvironmentStringField(src, 'environment.local.ts', 'vapidPublicKey'),
      ).toBe(pair.publicKey);
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
