# namou

NestJS 12 + Prisma 7 backend for a PostgreSQL mini e-commerce platform.

## Runtime

- Node.js `22.22.3` (see `.nvmrc`)
- PostgreSQL database named `namou`
- Redis available at `REDIS_URL` (local default: `redis://localhost:6379`)
- Prisma for ordinary persistence and parameterized raw SQL for PostgreSQL
  functions, partial-index upserts, and explicit row locks

```bash
nvm use
npm install
cp .env.example .env
npx prisma migrate deploy
redis-cli ping
npm run start:dev
```

The checked-in SQL migration is the physical database source of truth.
`prisma/schema.prisma` is its curated Prisma Client mapping. Use
`prisma migrate dev --name <change>` for later schema changes; do not use
`db push` for tracked environments.

`place_order` intentionally is not executable by PostgreSQL's `PUBLIC` role.
When deployment uses a restricted application role, provision that role and
apply the tracked environment-specific grant after migrations:

```bash
DATABASE_APPLICATION_ROLE=namou_app npm run db:grant:app
```

The wrapper removes Prisma-only connection parameters (such as
`schema=public`) before invoking `psql`; the role must always be supplied
explicitly by the deployment environment.

## Frontend

The production-oriented Next.js storefront lives in the separate
`namou-frontend` repository. In this workspace it is located at
`/Users/mohammadyassin/Documents/namou-frontend`. It runs on port `3001`, uses
this API on port `3000`, and implements the storefront, identity, account,
checkout, orders, realtime support, and permission-scoped admin areas.

## Feature modules

- `auth`: access JWTs, rotating refresh tokens, and permission-based guards
- `users`: current-user profile and transactional saved-address defaults
- `categories`: administration and recursive category-tree reads
- `products`: public catalog/search/filtering and product administration
- `variants`: reusable attributes, whole variant-matrix replacement, stock,
  price overrides, and image administration
- `cart`: authenticated carts and atomic guest-cart merge
- `wishlist`: authenticated wishlist and idempotent guest-wishlist merge
- `orders`: atomic checkout through `place_order`, immutable snapshots,
  cursor pagination, status transitions, and cancellation restocking
- `cache`: Redis-backed cache-aside reads with generation-based invalidation
- `jobs`: BullMQ order-confirmation producer and worker
- `chat`: persisted customer/support conversations over HTTP and Socket.io

Controllers own HTTP validation and authorization boundaries. Injectable
services own use-case orchestration. PostgreSQL remains authoritative for the
cross-row invariants and atomic checkout already defined in the migration.

## Main routes

| Area                 | Routes                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Attributes           | `GET/POST /attribute-types`, `PATCH/DELETE /attribute-types/:id`, value routes under `/:id/values`                          |
| Variants             | `GET/PUT /products/:id/variant-configuration`, `PATCH/DELETE /products/:id/variants/:variantId`, `PUT /products/:id/images` |
| Catalog              | `GET /products`, `GET /products/facets`, `GET /products/:slug`                                                              |
| Profile              | `GET/PATCH /users/me`                                                                                                       |
| Addresses            | `GET/POST /users/me/addresses`, `PATCH/DELETE /users/me/addresses/:id`                                                      |
| Cart                 | `GET /cart`, `POST /cart/items`, `PATCH/DELETE /cart/items/:variantId`, `POST /cart/merge`                                  |
| Wishlist             | `GET/POST /wishlist`, `DELETE /wishlist/:id`, `POST /wishlist/merge` (`GET` is cursor-paginated)                            |
| Customer orders      | `POST /orders/checkout`, `GET /orders`, `GET /orders/:id`                                                                   |
| Order administration | `GET /admin/orders`, `GET /admin/orders/:id`, `PATCH /admin/orders/:id/status`                                              |
| Customer chat        | `GET/POST /chat/conversations`, message, read, and close routes under `/:conversationId`                                    |
| Chat administration  | `GET /admin/chat/conversations`, assignment, message, read, and status routes under `/:conversationId`                      |

Liveness is available at `/health/live`; database readiness is available at
`/health/ready`. Interactive OpenAPI documentation is served at `/docs`; its machine-readable
document is available at `/docs/openapi.json`.

All routes are authenticated by default. Public routes opt out explicitly.
Attribute/variant routes require `manage_products`; admin order routes require
`manage_orders`; customer order routes require `view_orders`.

Guest cart and wishlist state never receives a database identity. The client
sends that state to the authenticated merge endpoints after login and clears
its local copy only after a successful response. Cart merge uses the maximum of
the saved and guest quantities for each variant, making the request safe to
retry; wishlist merge uses conflict-safe set semantics.

## Redis and background work

`REDIS_URL` is shared configuration, but caching and BullMQ own separate Redis
connections because they have different lifecycle and blocking requirements.
Category-tree and product-catalog reads use a 60-second cache-aside policy.
Writes advance a namespace generation instead of scanning/deleting keys, which
makes invalidation safe across multiple API processes; superseded values expire
naturally.

Checkout adds an `order-confirmation-<order id>` BullMQ job after PostgreSQL
commits. The deterministic job ID suppresses duplicate active/completed jobs,
and the worker retries transient failures three times with exponential backoff.
The processor currently establishes the notification-provider boundary and
logs the prepared confirmation; an email/SMS adapter can be injected there.

Checkout writes an order-confirmation outbox row in the same PostgreSQL
transaction as the order. A publisher retries unqueued rows when Redis is
temporarily unavailable, and the worker marks the row complete after preparing
the notification. The actual email/SMS provider remains an intentional future
integration.

## Live chat

Socket.io uses the `/chat` namespace. Pass the access JWT as
`auth: { token: accessToken }` during the handshake. Available client events:

- `conversation:join` / `conversation:leave` with `{ conversationId }`
- `message:send` with `{ conversationId, content }`
- server event `message:created` after the message transaction commits

HTTP history endpoints use opaque cursor pagination. Customers can access only
their own conversations. A support user with `manage_chat` can read the support
queue but must claim an open conversation before sending, matching the database
sender-integrity trigger.

## Verification

```bash
npm run build
npm run lint
npm test
npm run test:e2e
npx prisma validate
npx prisma migrate status
```

The commerce database smoke test runs all new workflows inside a rollback-only
transaction, including the real `place_order` function, so it does not leave
fixtures in the development database.

With current Prisma 7 driver adapters and `pg >= 8.19`, that rollback-only test
can emit node-postgres's one-time concurrent-query deprecation warning while
Prisma resolves nested relations on its single transaction connection. This is
tracked upstream in [prisma/prisma#29407](https://github.com/prisma/prisma/issues/29407);
the queries still complete, and the application does not launch work with
unawaited promises.

# namou-backend
