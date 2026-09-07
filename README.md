# namou backend

The namou backend is the HTTP, realtime, and background-processing layer for the namou commerce application. It owns authentication, authorization, catalog data, carts, wishlists, orders, customer addresses, chat, product image uploads, and the database rules that keep those operations consistent.

This repository is the source of truth for the backend. The companion Next.js storefront lives in `/Users/mohammadyassin/Documents/namou-frontend`.

The storefront uses Next.js because an e-commerce site benefits from
server-rendered pages, strong metadata support, and SEO-friendly product URLs.
Even if the project had started as a Node/Express application without a
frontend choice, I would still use Next.js as the web layer so the storefront
and server-side rendering could stay in one well-organized codebase.

If you are new to the project, start here, then read [the architecture guide](docs/ARCHITECTURE.md) and [the operations runbook](docs/RUNBOOK.md). The README is intentionally practical: it tells you how to run the service and where the important boundaries are.

## At a glance

| Area                    | Current implementation                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| HTTP API                | NestJS `12.0.1` on Express                                                                 |
| Realtime                | Socket.IO `4.8.3`, `/chat` namespace                                                       |
| Database                | PostgreSQL `16-alpine` locally, Prisma `7.10.0` with `pg` `8.23.0` and the driver adapter  |
| Cache and coordination  | Redis `7.4-alpine` locally, cache-manager `7.2.9`, Keyv Redis `5.1.6`, ioredis `6.0.0`     |
| Background jobs         | BullMQ `5.81.4`; currently order-confirmation jobs                                         |
| Authentication          | Passport/JWT (`12.0.0` / `12.0.1`), Argon2 `0.45.1` password hashes                        |
| Authorization           | Permission-based guards such as `manage_products`, `manage_orders`, and `manage_chat`      |
| Object storage          | Cloudflare R2 through AWS SDK S3/presigner `3.1127.0` and presigned URLs                   |
| Validation and security | Nest validation pipes, Helmet `8.3.0`, express-rate-limit `8.7.0`, and Redis store `6.0.1` |
| Language and tooling    | TypeScript `6.0.3`, Vitest `4.1.11`, Supertest `7.2.2`, Prettier `3.9.6`, oxlint `1.81.0`  |
| API reference           | Swagger/OpenAPI at `/docs` outside production                                              |

The versions above are the versions installed in the repositories on 2026-09-07. The lockfiles are authoritative for the complete dependency tree.

## What runs locally

The normal local setup has four pieces:

1. The NestJS API listens on port `3000`.
2. PostgreSQL runs on host port `15432` when started through Docker Compose.
3. Redis runs on host port `16379` when started through Docker Compose.
4. The Next.js frontend listens on port `3001` and talks to this API through its server-side BFF.

Start PostgreSQL and Redis from this repository with:

```bash
npm run infra:up
npm run infra:logs
```

The Compose services use named volumes, so stopping the containers does not remove local data. Use `npm run infra:down` when you want to stop them.

## Requirements

- Node.js `22.22.3` (the version in `.nvmrc`)
- npm
- Docker Desktop or another Docker Compose-compatible runtime
- PostgreSQL and Redis if you are not using the included Compose file
- An R2-compatible bucket only for product-image upload flows

## First-time setup

```bash
nvm use
npm install
cp .env.example .env
```

For the included local infrastructure, the important development values are:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:15432/namou?schema=public"
REDIS_URL="redis://localhost:16379"
CORS_ORIGINS="http://localhost:3001"
NODE_ENV="development"
PORT="3000"
```

Create the database schema and, when appropriate, seed a disposable local database:

```bash
npm run infra:up
npm run db:migrate
ALLOW_DESTRUCTIVE_SEED=true npm run db:seed
npm run start:dev
```

The seed command is deliberately guarded. It refuses production, refuses databases that do not look local to this project, and requires `ALLOW_DESTRUCTIVE_SEED=true` because it can replace development data. Do not use it as a production bootstrap mechanism.

## Environment variables

`.env.example` is the complete template. Never commit `.env`, credentials, JWT secrets, R2 keys, or a real database URL.

| Variable                                    | Purpose                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                              | PostgreSQL connection string used by Prisma                                                                        |
| `REDIS_URL`                                 | Redis connection used by caching, rate limits, and BullMQ                                                          |
| `CORS_ORIGINS`                              | Comma-separated browser origins allowed to call the API and Socket.IO gateway; use `http://localhost:3001` locally |
| `TRUST_PROXY_HOPS`                          | Number of trusted reverse-proxy hops; keep `0` unless the deployment topology requires another value               |
| `NODE_ENV`                                  | Runtime mode; Swagger is disabled when this is `production`                                                        |
| `PORT`                                      | HTTP listening port, normally `3000`                                                                               |
| `JWT_ACCESS_SECRET`                         | Secret used to sign access tokens; use a strong secret outside development                                         |
| `JWT_ACCESS_TTL_SECONDS`                    | Access-token lifetime                                                                                              |
| `JWT_ISSUER` / `JWT_AUDIENCE`               | JWT validation claims                                                                                              |
| `REFRESH_TOKEN_TTL_DAYS`                    | Refresh-token lifetime                                                                                             |
| `PENDING_ORDER_TTL_MINUTES`                 | Pending-order expiry window; local default is 30 minutes                                                           |
| `R2_ACCOUNT_ID`                             | Cloudflare account identifier                                                                                      |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 server credentials                                                                                              |
| `R2_BUCKET_NAME`                            | Bucket used for product images                                                                                     |
| `R2_PUBLIC_URL`                             | Public origin used to serve product images                                                                         |
| `R2_PRESIGNED_URL_TTL_SECONDS`              | Lifetime of a presigned upload URL                                                                                 |

## API surface

The exact DTO fields, response shapes, and bearer-auth metadata are generated by Swagger. Run the server in development and open `http://localhost:3000/docs`; the machine-readable document is at `http://localhost:3000/docs/openapi.json`. The following map is the conceptual surface maintained by the controllers:

| Area                | Routes                                                                                                               | Access                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Health              | `/health/live`, `/health/ready`                                                                                      | Public; readiness checks dependencies                                                             |
| Auth                | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/session`                                    | Register/login/refresh are public; session/logout require the authenticated session as applicable |
| Account             | `/users/me`, `/users/me/addresses`                                                                                   | Authenticated user                                                                                |
| Catalog             | `/products`, `/products/facets`, `/products/:slug`, `/categories/tree`, `/categories/:id`, `/categories/:id/subtree` | Public reads                                                                                      |
| Product management  | `/admin/products` and `/products/:productId/variant-configuration`                                                   | `manage_products`                                                                                 |
| Attributes          | `/attribute-types` and nested value routes                                                                           | `manage_products`                                                                                 |
| Category management | `/admin/categories`                                                                                                  | `manage_categories`                                                                               |
| Images              | `/uploads/products/:productId/presigned-url`, `/products/:productId/images`                                          | `manage_products`                                                                                 |
| Cart                | `/cart`, `/cart/items`, `/cart/items/:variantId`, `/cart/merge`                                                      | Authenticated user                                                                                |
| Wishlist            | `/wishlist`, item deletion, `/wishlist/merge`                                                                        | Authenticated user                                                                                |
| Orders              | `/orders/checkout`, `/orders`, `/orders/:id`                                                                         | Customer reads own orders; checkout requires an authenticated user                                |
| Order management    | `/admin/orders`, `/admin/orders/:id`, `/admin/orders/:id/status`                                                     | `view_orders` or `manage_orders` depending on operation                                           |
| Chat                | `/chat/conversations` and conversation/message actions                                                               | Authenticated user; access is checked per conversation                                            |
| Chat administration | `/admin/chat/conversations` and admin conversation actions                                                           | `manage_chat`                                                                                     |

All routes are protected by default unless explicitly marked public. Validation rejects unknown request fields. Do not add a new route only to work around a missing frontend client method; update the typed client and the contract together.

## Authentication and authorization

The backend uses short-lived JWT access tokens, rotating refresh tokens, and
Argon2id password hashes. Refresh tokens are stored as hashes and kept in
HttpOnly cookies by the Next.js layer.

Authorization is permission based. Roles can grant permissions such as
`manage_products`, `manage_categories`, `view_orders`, `manage_orders`, and
`manage_chat`, while ownership checks still protect customer resources.

## Rate limits and defensive defaults

Rate limits use Redis so they work across backend instances. The current HTTP limits are per one-minute window:

- `POST /auth/login`: 10 requests per minute
- `POST /auth/register`: 10 requests per minute
- `POST /auth/refresh`: 60 requests per minute
- catalog requests under `/products` and `/categories`: 120 requests per minute
- activity under `/chat`, `/admin/chat`, and `/uploads`: 120 requests per minute

The Socket.IO gateway has separate limits for connection attempts, user events, and sent messages. Helmet security headers, strict DTO validation, proxy-aware client addressing, and explicit CORS allow-lists are enabled in the application bootstrap.

## Data and order consistency

PostgreSQL is the source of truth, with Prisma providing the typed client and
SQL migrations defining the physical schema. Checkout runs through the
database `place_order` function so cart validation, stock checks, inventory
deduction, and order creation happen atomically.

The normal order lifecycle is:

```text
pending -> confirmed -> shipped -> delivered
    |          |
    +----------+----> cancelled
```

Pending orders are automatically expired after `PENDING_ORDER_TTL_MINUTES`; their stock is returned inside a transaction. Order-confirmation work is published through an outbox and BullMQ, so a temporary queue outage does not silently lose the intent to process the notification. The current processor prepares/logs the confirmation work; an external email or SMS provider is not integrated yet.

## Redis, BullMQ, and scheduled work

Redis has three different responsibilities and they should not be confused:

1. Cache product/catalog reads through cache-manager and Keyv.
2. Coordinate distributed HTTP and WebSocket rate limits.
3. Back BullMQ queues and store order-confirmation jobs.

BullMQ is currently used for the `orders` queue and its `order-confirmation` job. The backend also has short scheduled workers for pending-order expiry, refresh-token cleanup, and storage-object deletion outbox processing. These workers use database state, row locks, or claim fields so multiple instances can cooperate safely, but they still need operational monitoring.

## Realtime chat

Chat is available over HTTP and Socket.IO. The gateway uses the `/chat` namespace and validates the access token at connection time and again before handling events. Clients join conversation rooms and send `message:send`; the server emits `message:created` to the room after the message is accepted.

The current gateway does not configure a Socket.IO Redis adapter. Redis-backed rate limits and BullMQ therefore work across instances, but realtime room delivery is process-local. If the API is deployed as multiple instances behind a load balancer, add a compatible Socket.IO adapter and verify sticky-session or upgrade behavior before relying on cross-instance chat delivery.

## Product images

The backend does not proxy image bytes. An authorized admin requests a presigned R2 upload URL, uploads directly to the object store, and then records the product-image metadata through the API. Deleting an image records a deletion outbox entry so database state can be committed before external object deletion is retried safely.

## Development commands

```bash
npm run start:dev       # watch mode
npm run build           # compile the application
npm run start:prod      # run dist/main.js
npm run infra:up        # start PostgreSQL and Redis with Docker Compose
npm run infra:ps        # show Compose service health
npm run infra:logs      # follow PostgreSQL and Redis logs
npm run lint            # oxlint
npm run format         # format TypeScript and tests
npm run format:check   # verify formatting
npm test                # unit/integration tests
npm run test:e2e        # end-to-end tests
npm run check           # lint + format check + unit tests + build
npm run check:all       # check plus end-to-end tests
npm run db:migrate      # apply local migrations
npm run db:migrate:dev  # create/apply a development migration
npm run db:status       # show migration status
npm run db:validate     # validate Prisma schema/configuration
npm run db:format       # format Prisma schema
npm run db:studio       # open Prisma Studio/database browser
npm run prisma:generate # regenerate Prisma client
npm run docs:api:check  # verify that Swagger/OpenAPI is reachable
```

Start the API with `npm run start:dev`, then open Swagger at `http://localhost:3000/docs` or run `npm run docs:api:check` to verify both the UI route and `/docs/openapi.json`. Swagger is mounted outside production only. `npm run db:studio` opens Prisma Studio so you can inspect the database visually; `npm run prisma:studio` remains as a compatibility alias.

Before opening a change, run `npm run check`, `npm run test:e2e`, and `npm run docs:api:check` while the development server is running.

## Migrations and database access

Create a migration only after changing `prisma/schema.prisma` or a deliberate SQL migration. Review the generated SQL, especially for indexes, constraints, triggers, functions, and data backfills. Apply committed migrations with `npx prisma migrate deploy` in deployments. The `db:grant:app` script grants the restricted application role the privileges required by the current schema; run it against the intended database, not an arbitrary default database.

The current migration history includes the initial schema, order-notification outbox, backend hardening changes, and storage-object deletion outbox. Do not edit an applied migration; add a new migration instead.

## Deployment checklist

1. Provision PostgreSQL, Redis, and an R2 bucket.
2. Set production secrets and an exact `CORS_ORIGINS` allow-list.
3. Set `TRUST_PROXY_HOPS` to match the real reverse-proxy chain.
4. Install with `npm ci`, generate Prisma, and run `npx prisma migrate deploy`.
5. Apply application-role grants if the deployment uses the restricted database role.
6. Build with `npm run build` and run `npm run start:prod` under a supervisor.
7. Expose `/health/live` for process health and `/health/ready` for dependency readiness.
8. Monitor database connectivity, Redis connectivity, queue failures, outbox age, pending-order expiry, and storage deletion failures.
9. Do not run the destructive development seed in production.

Swagger is intentionally unavailable when `NODE_ENV=production`. Keep it behind network access controls in non-production environments.

## What is not implemented yet

These are current product boundaries, not hidden promises:

- There is no payment provider or payment capture flow; checkout creates a pending order.
- The order-confirmation processor does not send email or SMS yet.
- There is no general admin user/role-management UI or API documented here.
- The Socket.IO Redis adapter is not configured for multi-instance fan-out.
- Metrics, tracing, and a dedicated alerting integration are not part of this repository yet.
- The root `GET /` response is a compatibility greeting, not a health contract; use the health endpoints for monitoring.

## Documentation conventions

Good project documentation answers four questions without making the reader reconstruct the system from source code: what exists, how the pieces communicate, how to run it, and what is intentionally not there.

This repository follows that convention:

- `README.md` is the onboarding and command reference.
- `docs/ARCHITECTURE.md` explains boundaries, data flow, and design decisions.
- `docs/RUNBOOK.md` explains safe operations and troubleshooting.
- Swagger is the generated API contract for exact request and response shapes.
- The lockfile is the dependency-version record; documentation lists the important runtime versions and verified date.
- Documentation should describe current behavior as “current” and label future work as “planned” or “not implemented”.
- When a route, environment variable, job, database migration, or security boundary changes, update the relevant documentation in the same change.

Keep explanations close to the code they describe, prefer copy-pasteable commands, and remove stale claims instead of preserving them as “historical” instructions.


# namou-backend
