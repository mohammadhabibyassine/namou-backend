import { randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { type AuthenticatedUser } from '../src/auth/auth.types.js';
import { Permission } from '../src/auth/authorization/permission.constants.js';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator.js';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { RequirePermissions } from '../src/auth/decorators/require-permissions.decorator.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_TYPE,
} from '../src/auth/tokens/token.constants.js';
import { configureApplication } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

@Controller('__test/authorization')
class AuthorizationProbeController {
  @Get('public')
  @Public()
  publicRoute(): { public: true } {
    return { public: true };
  }

  @Get('authenticated')
  authenticatedRoute(
    @CurrentUser() user: AuthenticatedUser,
  ): AuthenticatedUser {
    return user;
  }

  @Get('orders')
  @RequirePermissions(Permission.ViewOrders)
  ordersRoute(): { permitted: true } {
    return { permitted: true };
  }

  @Get('products-admin')
  @RequirePermissions(Permission.ManageProducts)
  productsAdminRoute(): { permitted: true } {
    return { permitted: true };
  }
}

describe('JWT authentication and permission authorization (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const testEmails = new Set<string>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthorizationProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
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

  async function createSession(): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const email = `authorization-${randomUUID()}@example.com`;
    const password = 'a secure authorization passphrase';
    testEmails.add(email);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return {
      accessToken: login.body.accessToken,
      userId: registration.body.user.id,
    };
  }

  it('allows explicitly public routes and rejects missing authentication by default', async () => {
    await request(app.getHttpServer())
      .get('/__test/authorization/public')
      .expect(200, { public: true });
    await request(app.getHttpServer())
      .get('/__test/authorization/authenticated')
      .expect(401);
  });

  it('attaches current database-backed authorization to authenticated requests', async () => {
    const session = await createSession();

    const response = await request(app.getHttpServer())
      .get('/__test/authorization/authenticated')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      userId: session.userId,
      roleName: 'customer',
      permissions: ['view_orders'],
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('authorizes by permission and returns forbidden for an insufficient grant', async () => {
    const session = await createSession();
    const authorization = `Bearer ${session.accessToken}`;

    await request(app.getHttpServer())
      .get('/__test/authorization/orders')
      .set('Authorization', authorization)
      .expect(200, { permitted: true });

    const forbidden = await request(app.getHttpServer())
      .get('/__test/authorization/products-admin')
      .set('Authorization', authorization)
      .expect(403);

    expect(forbidden.body).toMatchObject({
      statusCode: 403,
      message: 'Insufficient permissions',
      error: 'Forbidden',
    });
  });

  it('rejects a validly signed JWT with the wrong explicit type', async () => {
    const session = await createSession();
    const wrongTypeToken = await jwtService.signAsync(
      {},
      {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        subject: session.userId,
        jwtid: randomUUID(),
        header: {
          alg: ACCESS_TOKEN_ALGORITHM,
          typ: 'different+jwt',
        },
      },
    );

    await request(app.getHttpServer())
      .get('/__test/authorization/authenticated')
      .set('Authorization', `Bearer ${wrongTypeToken}`)
      .expect(401);
  });

  it('rejects expired tokens and tokens with the wrong audience', async () => {
    const session = await createSession();
    const tokenOptions = {
      algorithm: ACCESS_TOKEN_ALGORITHM,
      subject: session.userId,
      jwtid: randomUUID(),
      header: {
        alg: ACCESS_TOKEN_ALGORITHM,
        typ: ACCESS_TOKEN_TYPE,
      },
    } as const;
    const expiredToken = await jwtService.signAsync(
      {},
      { ...tokenOptions, expiresIn: -1 },
    );
    const wrongAudienceToken = await jwtService.signAsync(
      {},
      { ...tokenOptions, audience: 'another-api' },
    );

    await request(app.getHttpServer())
      .get('/__test/authorization/authenticated')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/__test/authorization/authenticated')
      .set('Authorization', `Bearer ${wrongAudienceToken}`)
      .expect(401);
  });

  it('rejects an otherwise valid token after its user is deactivated', async () => {
    const session = await createSession();

    await prisma.user.update({
      where: { id: session.userId },
      data: { isActive: false },
      select: { id: true },
    });

    await request(app.getHttpServer())
      .get('/__test/authorization/authenticated')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
  });
});
