# Backend operations runbook

This is the short operational guide for local development and deployment. It assumes the reader has access to the repository and the required infrastructure credentials.

## Local start

```bash
nvm use
npm install
cp .env.example .env
npm run infra:up
npm run db:migrate
ALLOW_DESTRUCTIVE_SEED=true npm run db:seed
npm run start:dev
```

The API is then available at `http://localhost:3000`. Health endpoints are `GET /health/live` and `GET /health/ready`; Swagger is at `http://localhost:3000/docs` in development. The Docker Compose PostgreSQL and Redis ports are `15432` and `16379` respectively.

Run the frontend separately from `/Users/mohammadyassin/Documents/namou-frontend`.

## Safe database changes

1. Change the Prisma schema or write an intentional SQL migration.
2. Generate a migration in development and inspect the SQL.
3. Test it against a current database and a representative data set.
4. Commit the migration; never edit an already-applied migration.
5. Deploy with `npx prisma migrate deploy`.
6. Run `npm run db:grant:app` when the application-role privileges need to be updated.

For production, use a backup and a migration window appropriate to the size and locking behavior of the change. Do not use the development seed command.

## Deployment

The backend needs PostgreSQL, Redis, and—when image workflows are enabled—Cloudflare R2. A typical release is:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start:prod
```

Set `NODE_ENV=production`, strong JWT and database credentials, an explicit `CORS_ORIGINS`, and the correct `TRUST_PROXY_HOPS`. Swagger is not mounted in production.

Expose `/health/live` to the process supervisor and `/health/ready` to the load balancer. Readiness should fail when required database/Redis dependencies cannot be reached.

## Troubleshooting

### The API starts but catalog data is empty

Check the database URL, run `npx prisma migrate status`, and confirm that the database contains data. For a disposable local database only, run the guarded seed command. Do not seed a shared or production database.

### Requests return 429

The limits are Redis-backed and shared across instances. Check the caller’s request rate, Redis connectivity, and whether a reverse proxy is causing all clients to appear under one address. Do not increase a limit as the first response to a client retry loop.

### Login or refresh behaves inconsistently across instances

Check that all instances use the same JWT issuer/audience and secrets, that their clocks are synchronized, and that they share the intended Redis/database. Refresh rotation is stateful; a refresh token reused after rotation is expected to be rejected.

### Orders remain pending

Inspect application logs, the `order_notification_outbox` rows, BullMQ queue state, and the pending-order expiry worker. A queue outage should leave retryable outbox state. A pending order older than `PENDING_ORDER_TTL_MINUTES` should be cancelled by the periodic worker, subject to database availability.

### Product images do not appear

Check R2 credentials, bucket name, public URL, and the frontend image-origin configuration. Confirm that the presigned URL has not expired and that the uploaded object is under the allowed product-image prefix.

### Chat works on one instance but not another

This is an expected current limitation: the backend uses Redis for limits, not a Socket.IO adapter. Use one instance for development or add and test a Socket.IO Redis adapter before enabling multi-instance chat.

## Observability expectations

At minimum, monitor:

- liveness/readiness failures;
- PostgreSQL and Redis connection errors;
- HTTP 5xx and 429 rates;
- BullMQ waiting, failed, and stalled jobs;
- age and retry count of order and storage outbox rows;
- pending orders that exceed their configured TTL;
- Socket.IO connection and authentication failures.

There is no complete metrics/tracing integration in this repository yet, so logs and infrastructure-level metrics are currently the primary signals.

## Incident safety

Do not delete Redis data, truncate tables, revoke token families, or rerun seed scripts during an incident without identifying the exact blast radius. Prefer pausing the caller, fixing the dependency, and allowing the outbox/worker retry paths to recover. Record any manual data correction as a migration or an auditable administrative operation afterward.
