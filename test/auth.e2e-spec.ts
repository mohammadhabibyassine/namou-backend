import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { hashRefreshToken } from '../src/auth/tokens/refresh-token.crypto.js';

interface StoredRegistration {
  password_hash: string;
  role_name: string;
}

interface StoredLogin {
  user_id: string;
  token_hash: string;
  expires_at: Date;
  device_info: string | null;
}

interface StoredRotation {
  id: string;
  token_hash: string;
  token_family_id: string;
  replaced_by_token_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  device_info: string | null;
}

describe('Auth endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const testEmails = new Set<string>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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

  it('creates an authenticated-user record with an Argon2id password hash', async () => {
    const email = `registration-${randomUUID()}@example.com`;
    testEmails.add(email);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `  ${email.toUpperCase()}  `,
        password: 'only lowercase words with spaces',
        firstName: '  Ada  ',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      user: {
        email,
        firstName: 'Ada',
        lastName: null,
        phone: null,
        role: 'customer',
      },
    });
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.user).not.toHaveProperty('roleId');

    const records = await prisma.$queryRaw<StoredRegistration[]>`
      SELECT u.password_hash, r.name::text AS role_name
      FROM users AS u
      JOIN roles AS r ON r.id = u.role_id
      WHERE u.email = ${email}
    `;

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ role_name: 'customer' });
    expect(records[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('rejects duplicate email registration without leaking ORM details', async () => {
    const email = `duplicate-${randomUUID()}@example.com`;
    testEmails.add(email);
    const body = {
      email,
      password: 'a separate long passphrase',
    };

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(409);

    expect(response.body).toMatchObject({
      message: 'An account cannot be created with the supplied details',
      error: 'Conflict',
      statusCode: 409,
    });
    expect(JSON.stringify(response.body)).not.toContain('P2002');
  });

  it('rejects invalid and unexpected input before business logic runs', async () => {
    const email = `invalid-${randomUUID()}@example.com`;

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password: 'short',
        role: 'admin',
      })
      .expect(400);

    expect(response.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('password must be longer than or equal to 15'),
        'property role should not exist',
      ]),
    );
    await expect(prisma.user.count({ where: { email } })).resolves.toBe(0);
  });

  it('logs in with normalized credentials and persists a hashed refresh token', async () => {
    const email = `login-${randomUUID()}@example.com`;
    const password = 'a secure login passphrase';
    testEmails.add(email);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', 'namou-e2e-client')
      .send({
        email: ` ${email.toUpperCase()} `,
        password,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: registration.body.user.id,
        email,
        role: 'customer',
        permissions: ['view_orders'],
      },
    });

    const payload = await jwtService.verifyAsync<{
      sub: string;
      jti: string;
      iss: string;
      aud: string;
      exp: number;
      iat: number;
    }>(response.body.accessToken);
    const decoded = jwtService.decode(response.body.accessToken, {
      complete: true,
    });

    expect(payload).toMatchObject({
      sub: registration.body.user.id,
      jti: expect.any(String),
      iss: 'namou',
      aud: 'namou-api',
      exp: expect.any(Number),
      iat: expect.any(Number),
    });
    expect(decoded?.header).toMatchObject({ alg: 'HS256', typ: 'at+jwt' });

    const sessions = await prisma.$queryRaw<StoredLogin[]>`
      SELECT rt.user_id, rt.token_hash, rt.expires_at, rt.device_info
      FROM refresh_tokens AS rt
      WHERE rt.user_id = ${registration.body.user.id}::uuid
      ORDER BY rt.created_at DESC
      LIMIT 1
    `;

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      user_id: registration.body.user.id,
      token_hash: hashRefreshToken(response.body.refreshToken),
      device_info: 'namou-e2e-client',
    });
    expect(sessions[0]?.token_hash).not.toBe(response.body.refreshToken);
    expect(sessions[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('uses the same response for an unknown email and an incorrect password', async () => {
    const email = `login-failure-${randomUUID()}@example.com`;
    const password = 'a secure login passphrase';
    testEmails.add(email);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const incorrectPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'an incorrect passphrase' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: `unknown-${randomUUID()}@example.com`,
        password: 'an incorrect passphrase',
      })
      .expect(401);

    expect(incorrectPassword.body).toEqual(unknownEmail.body);
    expect(incorrectPassword.body).toMatchObject({
      message: 'Invalid email or password',
      error: 'Unauthorized',
      statusCode: 401,
    });
  });

  it('rotates refresh tokens atomically and revokes the family on replay', async () => {
    const email = `rotation-${randomUUID()}@example.com`;
    const password = 'a secure rotation passphrase';
    testEmails.add(email);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', 'original-client')
      .send({ email, password })
      .expect(200);

    const rotation = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('User-Agent', 'current-client')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    expect(rotation.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(rotation.body.refreshToken).not.toBe(login.body.refreshToken);

    const records = await prisma.$queryRaw<StoredRotation[]>`
      SELECT
        id,
        token_hash,
        token_family_id,
        replaced_by_token_id,
        expires_at,
        revoked_at,
        device_info
      FROM refresh_tokens
      WHERE user_id = ${registration.body.user.id}::uuid
      ORDER BY created_at
    `;
    const original = records.find(
      ({ token_hash }) =>
        token_hash === hashRefreshToken(login.body.refreshToken),
    );
    const replacement = records.find(
      ({ token_hash }) =>
        token_hash === hashRefreshToken(rotation.body.refreshToken),
    );

    expect(records).toHaveLength(2);
    expect(original).toMatchObject({
      replaced_by_token_id: replacement?.id,
      device_info: 'original-client',
      revoked_at: expect.any(Date),
    });
    expect(replacement).toMatchObject({
      token_family_id: original?.token_family_id,
      replaced_by_token_id: null,
      revoked_at: null,
      device_info: 'current-client',
    });
    expect(replacement?.expires_at.getTime()).toBe(
      original?.expires_at.getTime(),
    );

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    await expect(
      prisma.refreshToken.count({
        where: {
          tokenFamilyId: original?.token_family_id,
          revokedAt: null,
        },
      }),
    ).resolves.toBe(0);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotation.body.refreshToken })
      .expect(401);
  });

  it('logs out idempotently by revoking the complete session family', async () => {
    const email = `logout-${randomUUID()}@example.com`;
    const password = 'a secure logout passphrase';
    testEmails.add(email);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);

    await expect(
      prisma.refreshToken.count({
        where: {
          userId: registration.body.user.id,
          revokedAt: null,
        },
      }),
    ).resolves.toBe(0);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    // Unknown but well-formed tokens are also an idempotent success, avoiding
    // a token-existence oracle on the logout route.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: 'a'.repeat(43) })
      .expect(204);
  });

  it('does not let a refresh token escape a concurrent logout', async () => {
    const email = `refresh-logout-race-${randomUUID()}@example.com`;
    const password = 'a secure concurrent logout passphrase';
    testEmails.add(email);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const [refresh, logout] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken }),
      request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: login.body.refreshToken }),
    ]);

    expect([200, 401]).toContain(refresh.status);
    expect(logout.status).toBe(204);
    await expect(
      prisma.refreshToken.count({
        where: {
          userId: registration.body.user.id,
          revokedAt: null,
        },
      }),
    ).resolves.toBe(0);
  });
});
