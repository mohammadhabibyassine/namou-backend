import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Category endpoint boundaries (e2e)', () => {
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
      where: {
        email: {
          in: [...testEmails],
        },
      },
    });
    await app.close();
  });

  it('exposes the active category tree without authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/categories/tree')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
  });

  it('validates category path identifiers at the controller boundary', async () => {
    await request(app.getHttpServer())
      .get('/categories/not-a-uuid')
      .expect(400);
    await request(app.getHttpServer())
      .get('/categories/not-a-uuid/subtree')
      .expect(400);
  });

  it('protects category writes by authentication and database permission', async () => {
    const slug = `forbidden-${randomUUID()}`;

    await request(app.getHttpServer())
      .post('/categories')
      .send({ name: 'Forbidden category', slug })
      .expect(401);

    const email = `category-permission-${randomUUID()}@example.com`;
    const password = 'a secure category passphrase';
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
      .post('/categories')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Forbidden category', slug })
      .expect(403);

    await expect(prisma.category.count({ where: { slug } })).resolves.toBe(0);
  });
});
