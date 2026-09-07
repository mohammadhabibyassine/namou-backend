import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ApplicationCacheService } from '../src/cache/application-cache.service.js';
import { CacheNamespace } from '../src/cache/cache.constants.js';

describe('Redis-backed application cache (e2e)', () => {
  let app: INestApplication;
  let cache: ApplicationCacheService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    cache = app.get(ApplicationCacheService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('round-trips structured values through Redis and invalidates generations', async () => {
    const logicalKey = `integration:${randomUUID()}`;
    const timestamp = new Date('2026-09-06T10:00:00.123Z');
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ source: 'database', values: [1, 2], timestamp })
      .mockResolvedValueOnce({ source: 'updated', values: [3] });

    const first = await cache.remember(
      CacheNamespace.ProductCatalog,
      logicalKey,
      60_000,
      loader,
    );
    const cached = await cache.remember(
      CacheNamespace.ProductCatalog,
      logicalKey,
      60_000,
      loader,
    );
    expect(first).toEqual({ source: 'database', values: [1, 2], timestamp });
    expect(cached).toEqual(first);
    expect(cached.timestamp).toBeInstanceOf(Date);
    expect(loader).toHaveBeenCalledOnce();

    await cache.invalidate(CacheNamespace.ProductCatalog);
    await expect(
      cache.remember(CacheNamespace.ProductCatalog, logicalKey, 60_000, loader),
    ).resolves.toEqual({ source: 'updated', values: [3] });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
