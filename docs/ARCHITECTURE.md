# Backend architecture

This document describes how the backend is shaped and why the main boundaries exist. It is a companion to the root README, not a second API specification. For exact DTOs and response fields, use the development Swagger document.

## System boundary

```text
Browser
  |
  | same-origin requests to Next.js BFF
  v
namou-frontend (Next.js :3001)
  |
  | server-side HTTP calls with access token
  v
namou backend (NestJS/Express :3000)
  |             |                |                 |
  v             v                v                 v
PostgreSQL    Redis          BullMQ             Cloudflare R2
  |                              |
  +-- transactional checkout     +-- order-confirmation worker

Browser -- Socket.IO handshake --> backend /chat namespace
```

The frontend is a backend-for-frontend (BFF), so the browser does not call most backend HTTP endpoints directly. This backend still owns the security decision: authentication guards, permissions, ownership checks, DTO validation, and database constraints are enforced here.

## NestJS module boundaries

The source is organized by capability rather than by transport type. The important modules are:

| Module       | Responsibility                                                                            |
| ------------ | ----------------------------------------------------------------------------------------- |
| `auth`       | Registration, login, sessions, JWT verification, refresh-token rotation, password hashing |
| `users`      | Current-user profile and addresses                                                        |
| `categories` | Public category tree and administrative category changes                                  |
| `attributes` | Product attribute types and values                                                        |
| `products`   | Product CRUD, public catalog queries, facets, and product images                          |
| `variants`   | Variant matrix configuration and stock-sensitive variant operations                       |
| `cart`       | Authenticated cart contents and guest-cart merge                                          |
| `wishlist`   | Authenticated wishlist contents and guest-wishlist merge                                  |
| `orders`     | Checkout, order reads, status transitions, and administrative order actions               |
| `chat`       | Conversation/message HTTP APIs and the Socket.IO gateway                                  |
| `storage`    | R2 presigned URLs and safe object-deletion outbox processing                              |
| `jobs`       | BullMQ queue configuration, order outbox publication, and processing                      |
| `rate-limit` | Redis-backed shared request counters                                                      |
| `cache`      | Redis-backed catalog caching                                                              |
| `prisma`     | Database client lifecycle and application-role access                                     |
| `health`     | Liveness and readiness checks                                                             |

Controllers translate HTTP or Socket.IO input into service calls. Services contain business rules. Prisma and explicit SQL are used at the persistence boundary. Cross-cutting concerns are applied through guards, pipes, interceptors, and application bootstrap configuration.

## Request lifecycle

For an HTTP request, the usual path is:

```text
request
  -> Helmet/CORS/rate limiter
  -> Nest routing
  -> authentication guard (unless @Public)
  -> permission/ownership guards
  -> DTO validation and transformation
  -> controller
  -> service
  -> Prisma or explicit SQL transaction
  -> response serializer/interceptor
```

The global validation pipe strips nothing silently: it whitelists DTO fields and rejects unknown fields. That makes client/server drift visible instead of allowing unvalidated input to reach a service.

## Authentication flow

```text
register/login
  -> validate credentials
  -> Argon2id password verification
  -> create access token + refresh token family
  -> frontend stores tokens in HttpOnly cookies

authenticated BFF request
  -> frontend server reads access cookie
  -> backend verifies issuer/audience/signature/expiry
  -> guards check permission and resource ownership

refresh
  -> refresh token hash is looked up
  -> token is rotated and old token is invalidated
  -> a new access/refresh pair is returned
```

The frontend deliberately keeps persistent tokens out of browser JavaScript. For chat, the frontend obtains a short-lived socket token through its own server route, then presents it during the Socket.IO handshake. The gateway authenticates at connection time and re-authenticates before each event so revoked or expired access is not treated as permanent.

## Catalog and caching

Public product and category reads can be cached in Redis. Cache invalidation belongs beside the write that changes the corresponding catalog data. The cache is an optimization, never the source of truth: a cache miss or Redis outage must not change the database result semantics.

The product list supports cursor-based pagination and catalog facets. The frontend has separate server and browser API adapters, but both ultimately consume this backend contract.

## Checkout and inventory

Checkout is intentionally database-centered. The PostgreSQL `place_order` function performs the stock-sensitive portion atomically: it validates the cart and address, locks relevant rows, verifies quantities, deducts stock, and creates the order. This avoids a read-then-write race in application code.

Pending orders are later expired by the order jobs service. Expiry locks the order, checks that it is still pending, restores every item quantity, marks the order cancelled, and completes the confirmation outbox entry in one transaction.

Order-confirmation publication uses an outbox. The order transaction records the intent, and a retrying publisher places a BullMQ job. The processor is idempotent by order/job identity and currently prepares/logs the confirmation rather than calling an email or SMS provider.

## Realtime chat

The chat gateway is a Socket.IO namespace at `/chat`. A client can join a conversation room, leave it, or send a message. The chat service repeats access checks at the message boundary; joining a room is not itself permission to write.

Redis shares rate-limit state, but no Socket.IO Redis adapter is installed. Consequently, a room and its connected sockets are known to one backend process. A future multi-instance deployment needs an adapter and an operational test for websocket upgrades and cross-instance events.

## Storage flow

```text
admin frontend
  -> backend asks R2 for a presigned PUT URL
  -> browser uploads bytes directly to R2
  -> backend records image metadata/order on the product
  -> deletion records an outbox row
  -> cleanup worker deletes the remote object and marks the row complete
```

The backend never needs to stream image bytes through the API. Presigned URLs reduce API load and keep storage credentials server-side. The deletion outbox protects against the opposite failure mode: database metadata must not disappear while the external object remains unmanaged because a remote delete failed.

## Redis responsibilities

There are three separate consumers of Redis:

1. Keyv/cache-manager for product/category cache entries.
2. The `RateLimitService` for HTTP and Socket.IO counters.
3. BullMQ for queue state and job delivery.

These consumers can share a Redis deployment, but production operations should monitor memory policy, connectivity, latency, and queue backlog. Clearing Redis is safe only if the team understands that it removes cache, rate-limit counters, and BullMQ state together.

## Database conventions

- Prisma 7 is configured with the PostgreSQL driver adapter.
- SQL migrations, constraints, functions, and indexes are committed under `prisma/migrations`.
- The application uses a restricted database role when configured; schema ownership and migration privileges should remain separate.
- Stock, order status, refresh-token rotation, and outbox claims must be changed transactionally.
- Applied migrations are immutable. Add a new migration for every subsequent change.

## Failure boundaries

The system is designed to degrade in a few deliberate ways:

- Redis cache failure should make reads slower, not incorrect.
- A queue outage leaves order-confirmation intent in the outbox for retry.
- An R2 deletion outage leaves a retryable storage outbox row.
- A stale pending order is cancelled only after a database lock confirms it is still pending.
- A missing or invalid access token is rejected by the backend even if the frontend route guard was bypassed.

The system does not yet provide a complete metrics/tracing pipeline or cross-instance Socket.IO fan-out. Those are deployment concerns to solve before scaling horizontally.
