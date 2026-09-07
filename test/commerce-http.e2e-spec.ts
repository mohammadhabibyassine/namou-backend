import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Commerce HTTP boundaries (e2e)', () => {
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

  it.each(['/users/me', '/cart', '/wishlist', '/orders', '/attribute-types'])(
    'keeps %s authenticated by default',
    async (route) => {
      await request(app.getHttpServer()).get(route).expect(401);
    },
  );

  it('exposes storefront filter facets without exposing attribute administration', async () => {
    await request(app.getHttpServer())
      .get('/products/facets')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          attributes: expect.any(Array),
          priceRanges: expect.any(Array),
        });
      });
  });

  it('wires profile, address, empty commerce resources, and RBAC through HTTP', async () => {
    const email = `commerce-http-${randomUUID()}@example.com`;
    const password = 'a secure commerce http passphrase';
    testEmails.add(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const authorization = `Bearer ${login.body.accessToken}`;

    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', authorization)
      .send({ firstName: 'Maya' })
      .expect(200)
      .expect(({ body }) => expect(body.firstName).toBe('Maya'));

    const address = await request(app.getHttpServer())
      .post('/users/me/addresses')
      .set('Authorization', authorization)
      .send({
        recipientName: 'Maya Customer',
        addressLine1: '1 Test Street',
        city: 'Beirut',
        postalCode: '1107',
        countryCode: 'lb',
      })
      .expect(201);
    expect(address.body).toMatchObject({ countryCode: 'LB', isDefault: true });

    await request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', authorization)
      .expect(200, { items: [], itemCount: 0, quantityTotal: 0 });
    await request(app.getHttpServer())
      .get('/wishlist')
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          items: [],
          itemCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
      );
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) => expect(body.items).toEqual([]));
    await request(app.getHttpServer())
      .get('/attribute-types')
      .set('Authorization', authorization)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/users/me/addresses/${address.body.id}`)
      .set('Authorization', authorization)
      .expect(204);
  });
});
