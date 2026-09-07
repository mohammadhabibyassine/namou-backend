import type { Cache } from 'cache-manager';
import { ApplicationCacheService } from './application-cache.service.js';
import { CacheNamespace } from './cache.constants.js';

describe('ApplicationCacheService', () => {
  const values = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => values.get(key));
  const set = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });
  const cache = { get, set } as unknown as Cache;
  const service = new ApplicationCacheService(cache);

  beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
  });

  it('loads once and serves subsequent reads from the generated cache key', async () => {
    const loader = vi.fn().mockResolvedValue({ items: ['cached'] });

    await expect(
      service.remember(CacheNamespace.ProductCatalog, 'page:1', 60_000, loader),
    ).resolves.toEqual({ items: ['cached'] });
    await expect(
      service.remember(CacheNamespace.ProductCatalog, 'page:1', 60_000, loader),
    ).resolves.toEqual({ items: ['cached'] });

    expect(loader).toHaveBeenCalledOnce();
  });

  it('advances a namespace generation without scanning cache keys', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce('before')
      .mockResolvedValueOnce('after');

    await service.remember(CacheNamespace.Categories, 'tree', 60_000, loader);
    await service.invalidate(CacheNamespace.Categories);
    await expect(
      service.remember(CacheNamespace.Categories, 'tree', 60_000, loader),
    ).resolves.toBe('after');

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent cache misses within one process', async () => {
    let resolveLoad: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      resolveLoad = resolve;
    });
    const loader = vi.fn(() => pending);

    const first = service.remember(
      CacheNamespace.Categories,
      'tree',
      60_000,
      loader,
    );
    const second = service.remember(
      CacheNamespace.Categories,
      'tree',
      60_000,
      loader,
    );
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    resolveLoad('tree');

    await expect(Promise.all([first, second])).resolves.toEqual([
      'tree',
      'tree',
    ]);
  });
});
