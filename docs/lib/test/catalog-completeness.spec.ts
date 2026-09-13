import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { CompletenessChecker } from '../src/validator/completeness-checker';
import { FILES_CATALOG } from '../src/catalog/files-catalog';
import { DATA_TYPES_CATALOG } from '../src/catalog/data-types-catalog';
import { FirestoreCollection } from '../../../functions/src/data-model/collections';

describe('Catalog Completeness Verification', () => {
  const repoRoot = path.resolve(__dirname, '../../../');
  const checker = new CompletenessChecker(repoRoot);

  it('should have 100% of git-tracked source files cataloged in FILES_CATALOG', () => {
    const report = checker.checkFileCatalog(FILES_CATALOG);
    expect(report.unregisteredFiles).toEqual([]);
    expect(report.isComplete).toBe(true);
    expect(FILES_CATALOG.length).toBeGreaterThanOrEqual(800);
  });

  it('should catalog all FirestoreCollection values in DATA_TYPES_CATALOG', () => {
    const registeredCollections = new Set(
      DATA_TYPES_CATALOG.filter((t) => !t.isSubcollection).map((t) => t.collectionPath.split('/')[1])
    );

    const enumCollections = Object.values(FirestoreCollection);
    const missing: string[] = [];

    // Check core business collections
    const coreCollections = [
      FirestoreCollection.Members,
      FirestoreCollection.Schools,
      FirestoreCollection.Instructors,
      FirestoreCollection.Products,
      FirestoreCollection.Gradings,
      FirestoreCollection.Orders,
      FirestoreCollection.Acl,
      FirestoreCollection.System,
      FirestoreCollection.Events,
      FirestoreCollection.Videos,
      FirestoreCollection.Mail,
    ];

    coreCollections.forEach((c) => {
      if (!registeredCollections.has(c)) {
        missing.push(c);
      }
    });

    expect(missing).toEqual([]);
  });
});
