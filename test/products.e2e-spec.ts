import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Public product catalog boundaries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const testEmails = new Set<string>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [...testEmails] } },
    });
    await app.close();
  });

  it('returns a public cursor page through the real PostgreSQL query', async () => {
    const response = await request(app.getHttpServer())
      .get('/products')
      .expect(200);

    expect(response.body).toMatchObject({
      items: expect.any(Array),
      pageInfo: {
        hasNextPage: expect.any(Boolean),
      },
    });
  });

  it('rejects malformed filters before reaching the catalog query', async () => {
    const response = await request(app.getHttpServer())
      .get('/products')
      .query({
        categoryId: 'not-a-uuid',
        minPrice: '-1',
        pageSize: 500,
        unknown: 'field',
      })
      .expect(400);

    expect(response.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('categoryId must be a UUID'),
        expect.stringContaining('minPrice must be a non-negative amount'),
        expect.stringContaining('pageSize must not be greater than 100'),
        'property unknown should not exist',
      ]),
    );
  });

  it('rejects malformed product slugs at the route boundary', async () => {
    await request(app.getHttpServer())
      .get('/products/not%20a%20slug')
      .expect(400);
  });

  it('protects product administration by authentication and RBAC permission', async () => {
    const slug = `forbidden-product-${randomUUID()}`;
    const payload = {
      categoryId: randomUUID(),
      title: 'Forbidden product',
      slug,
      basePrice: '10.00',
      variants: [
        {
          sku: `FORBIDDEN-${randomUUID()}`,
          isDefault: true,
        },
      ],
    };

    await request(app.getHttpServer())
      .post('/products')
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/products/${randomUUID()}`)
      .send({ title: 'Forbidden rename' })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/products/${randomUUID()}`)
      .expect(401);

    const email = `product-permission-${randomUUID()}@example.com`;
    const password = 'a secure product passphrase';
    testEmails.add(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send(payload)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/products/${randomUUID()}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ title: 'Forbidden rename' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/products/${randomUUID()}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);

    await expect(prisma.product.count({ where: { slug } })).resolves.toBe(0);
  });
});
