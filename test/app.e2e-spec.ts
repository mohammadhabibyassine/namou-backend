import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { configureApplication } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('serves the generated namou OpenAPI document', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs/openapi.json')
      .expect(200);

    expect(response.body).toMatchObject({
      info: { title: 'namou API', version: '1.0' },
      paths: expect.objectContaining({
        '/health/live': expect.any(Object),
        '/health/ready': expect.any(Object),
        '/products': expect.any(Object),
        '/orders/checkout': expect.any(Object),
        '/chat/conversations': expect.any(Object),
      }),
    });
  });

  it('uses UTC for every Prisma PostgreSQL session', async () => {
    const [databaseClock] = await prisma.$queryRaw<
      { databaseNow: Date; timezone: string }[]
    >`
      SELECT
        now() AS "databaseNow",
        current_setting('TimeZone') AS timezone
    `;

    expect(databaseClock?.timezone).toBe('UTC');
    expect(
      Math.abs((databaseClock?.databaseNow.getTime() ?? 0) - Date.now()),
    ).toBeLessThan(5_000);
  });

  afterAll(async () => {
    await app.close();
  });
});
