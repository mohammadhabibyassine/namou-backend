import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const applicationRole = process.env.DATABASE_APPLICATION_ROLE;

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!applicationRole) {
  console.error('DATABASE_APPLICATION_ROLE is required');
  process.exit(1);
}

let psqlDatabaseUrl;
try {
  const parsedUrl = new URL(databaseUrl);
  // These parameters are understood by Prisma, but not by libpq/psql.
  for (const parameter of [
    'schema',
    'connection_limit',
    'pool_timeout',
    'socket_timeout',
  ]) {
    parsedUrl.searchParams.delete(parameter);
  }
  psqlDatabaseUrl = parsedUrl.toString();
} catch {
  console.error('DATABASE_URL must be a valid PostgreSQL URL');
  process.exit(1);
}

const grantFile = fileURLToPath(
  new URL('../prisma/deployment/grant-app-role.sql', import.meta.url),
);
const result = spawnSync(
  'psql',
  [
    '--dbname',
    psqlDatabaseUrl,
    '--set',
    `application_role=${applicationRole}`,
    '--file',
    grantFile,
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(`Could not run psql: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
