/* in-memory-firestore.ts
 *
 * A deliberately tiny in-memory stand-in for the slice of the firebase-admin
 * Firestore API used by the login-path functions (findMemberDocsForEmail,
 * getUserDetails): doc get/set/update, `where(field, 'array-contains', v)`,
 * `getAll`, and batches. Tests seed it with plain objects and then assert on
 * the stored documents, rather than on mock call sequences.
 *
 * Usage (in a spec):
 *   const fake = new InMemoryFirestore({ acl: { 'a@b.com': {...} }, members: {...} });
 *   vi.spyOn(admin, 'firestore').mockReturnValue(fake.asFirestore());
 *   ...
 *   expect(fake.data('acl', 'a@b.com')).toEqual(...);
 */

import * as admin from 'firebase-admin';

type DocData = Record<string, unknown>;
type Store = Map<string, Map<string, DocData>>;

class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly value: DocData | undefined,
  ) {}
  get exists(): boolean {
    return this.value !== undefined;
  }
  data(): DocData | undefined {
    return this.value === undefined ? undefined : { ...this.value };
  }
}

class FakeDocRef {
  constructor(
    private readonly store: Store,
    readonly collectionName: string,
    readonly id: string,
  ) {}
  private coll(): Map<string, DocData> {
    let coll = this.store.get(this.collectionName);
    if (!coll) {
      coll = new Map();
      this.store.set(this.collectionName, coll);
    }
    return coll;
  }
  async get(): Promise<FakeSnapshot> {
    return new FakeSnapshot(this.id, this.coll().get(this.id));
  }
  async set(data: DocData, options?: { merge?: boolean }): Promise<void> {
    const previous = options?.merge ? this.coll().get(this.id) ?? {} : {};
    this.coll().set(this.id, { ...previous, ...data });
  }
  async update(data: DocData): Promise<void> {
    const previous = this.coll().get(this.id);
    if (!previous) throw new Error(`No document to update: ${this.collectionName}/${this.id}`);
    this.coll().set(this.id, { ...previous, ...data });
  }
}

let autoIdCounter = 0;

class FakeCollection {
  constructor(
    private readonly store: Store,
    private readonly name: string,
  ) {}
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.store, this.name, id ?? `auto-id-${++autoIdCounter}`);
  }
  where(field: string, op: string, value: unknown) {
    if (op !== 'array-contains') throw new Error(`Unsupported operator: ${op}`);
    return {
      get: async () => {
        const docs = [...(this.store.get(this.name) ?? new Map()).entries()]
          .filter(([, data]) => Array.isArray(data[field]) && (data[field] as unknown[]).includes(value))
          .map(([id, data]) => new FakeSnapshot(id, data));
        return { empty: docs.length === 0, docs };
      },
    };
  }
}

export class InMemoryFirestore {
  private readonly store: Store = new Map();

  constructor(seed: Record<string, Record<string, DocData>> = {}) {
    for (const [collection, docs] of Object.entries(seed)) {
      this.store.set(collection, new Map(Object.entries(docs)));
    }
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this.store, name);
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeSnapshot[]> {
    return Promise.all(refs.map((ref) => ref.get()));
  }

  batch() {
    const ops: Array<() => Promise<void>> = [];
    return {
      set: (ref: FakeDocRef, data: DocData, options?: { merge?: boolean }) => {
        ops.push(() => ref.set(data, options));
      },
      update: (ref: FakeDocRef, data: DocData) => {
        ops.push(() => ref.update(data));
      },
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  }

  // The stored data for one document, or undefined if it does not exist.
  data(collection: string, id: string): DocData | undefined {
    return this.store.get(collection)?.get(id);
  }

  // The IDs of all documents in a collection.
  ids(collection: string): string[] {
    return [...(this.store.get(collection)?.keys() ?? [])];
  }

  asFirestore(): admin.firestore.Firestore {
    return this as unknown as admin.firestore.Firestore;
  }
}
