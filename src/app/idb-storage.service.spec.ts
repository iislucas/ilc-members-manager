import { describe, it, expect, beforeEach } from 'vitest';
import { IdbStorageService } from './idb-storage.service';

describe('IdbStorageService', () => {
  let service: IdbStorageService;

  beforeEach(() => {
    service = new IdbStorageService();
  });

  it('sets and gets values correctly', async () => {
    await service.set('test-key', { foo: 'bar', count: 42 });
    const result = await service.get<{ foo: string; count: number }>('test-key');
    expect(result).toEqual({ foo: 'bar', count: 42 });
  });

  it('returns undefined for non-existent key', async () => {
    const result = await service.get('missing-key');
    expect(result).toBeUndefined();
  });

  it('deletes keys correctly', async () => {
    await service.set('to-delete', 'some value');
    expect(await service.get('to-delete')).toBe('some value');
    await service.delete('to-delete');
    expect(await service.get('to-delete')).toBeUndefined();
  });

  it('clears all entries correctly', async () => {
    await service.set('k1', 1);
    await service.set('k2', 2);
    expect(await service.keys()).toContain('k1');
    expect(await service.keys()).toContain('k2');

    await service.clear();
    expect(await service.get('k1')).toBeUndefined();
    expect(await service.get('k2')).toBeUndefined();
  });
});
