import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_TYPE,
} from '../src/auth/tokens/token.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Persisted support chat (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let baseUrl: string;
  const userIds = new Set<string>();
  const conversationIds = new Set<string>();
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await prisma.chatConversation.deleteMany({
      where: { id: { in: [...conversationIds] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await app.close();
  });

  it('enforces ownership and assignment while persisting Socket.io messages', async () => {
    const customer = await createCustomerSession();
    const otherCustomer = await createCustomerSession();
    const support = await createSupportSession();

    const conversation = await request(app.getHttpServer())
      .post('/chat/conversations')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ subject: 'Order delivery question' })
      .expect(201);
    conversationIds.add(conversation.body.id);

    await request(app.getHttpServer())
      .post(`/chat/conversations/${conversation.body.id}/messages`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ content: 'When will my order arrive?' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/chat/conversations/${conversation.body.id}/messages`)
      .set('Authorization', `Bearer ${otherCustomer.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/admin/chat/conversations/${conversation.body.id}/messages`)
      .set('Authorization', `Bearer ${support.token}`)
      .send({ content: 'Unclaimed reply' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/admin/chat/conversations/${conversation.body.id}/assignment`)
      .set('Authorization', `Bearer ${support.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.assignedAdminId).toBe(support.userId));

    const customerSocket = await connectSocket(customer.token);
    const supportSocket = await connectSocket(support.token);
    await emitWithAck(customerSocket, 'conversation:join', {
      conversationId: conversation.body.id,
    });
    await emitWithAck(supportSocket, 'conversation:join', {
      conversationId: conversation.body.id,
    });

    const broadcast = new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for chat broadcast')),
          3_000,
        );
        customerSocket.once('message:created', (message) => {
          clearTimeout(timeout);
          resolve(message as Record<string, unknown>);
        });
      },
    );
    const acknowledgement = await emitWithAck<Record<string, unknown>>(
      supportSocket,
      'message:send',
      {
        conversationId: conversation.body.id,
        content: 'It will arrive tomorrow.',
      },
    );
    expect(acknowledgement).toMatchObject({
      conversationId: conversation.body.id,
      senderId: support.userId,
      content: 'It will arrive tomorrow.',
    });
    await expect(broadcast).resolves.toMatchObject(acknowledgement);

    await request(app.getHttpServer())
      .get(`/chat/conversations/${conversation.body.id}/messages`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(
          body.items.map(({ content }: { content: string }) => content),
        ).toEqual(
          expect.arrayContaining([
            'When will my order arrive?',
            'It will arrive tomorrow.',
          ]),
        );
      });

    await request(app.getHttpServer())
      .patch(`/chat/conversations/${conversation.body.id}/read`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200, { updatedCount: 1 });

    await request(app.getHttpServer())
      .patch(`/chat/conversations/${conversation.body.id}/close`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('closed'));
    await request(app.getHttpServer())
      .patch(`/admin/chat/conversations/${conversation.body.id}/status`)
      .set('Authorization', `Bearer ${support.token}`)
      .send({ status: 'archived' })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('archived'));
  });

  async function createCustomerSession(): Promise<{
    userId: string;
    token: string;
  }> {
    const email = `chat-customer-${randomUUID()}@example.com`;
    const password = 'a secure chat customer passphrase';
    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    userIds.add(registration.body.user.id);
    return {
      userId: registration.body.user.id,
      token: login.body.accessToken,
    };
  }

  async function createSupportSession(): Promise<{
    userId: string;
    token: string;
  }> {
    const user = await prisma.user.create({
      data: {
        email: `chat-support-${randomUUID()}@example.com`,
        passwordHash: 'not-used-by-this-test',
        role: { connect: { name: 'support_agent' } },
      },
      select: { id: true },
    });
    userIds.add(user.id);
    const token = await jwt.signAsync(
      {},
      {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        subject: user.id,
        jwtid: randomUUID(),
        header: {
          alg: ACCESS_TOKEN_ALGORITHM,
          typ: ACCESS_TOKEN_TYPE,
        },
      },
    );
    return { userId: user.id, token };
  }

  function connectSocket(token: string): Promise<Socket> {
    const socket = io(`${baseUrl}/chat`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sockets.add(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function emitWithAck<T = Record<string, unknown>>(
    socket: Socket,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      socket
        .timeout(3_000)
        .emit(event, payload, (error: Error | null, response: T) =>
          error ? reject(error) : resolve(response),
        );
    });
  }
});
