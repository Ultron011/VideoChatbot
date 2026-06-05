// Loads the shared per-environment credential file: env/.env.${APP_ENV} at the
// repo root. Resolved relative to THIS file (not the cwd), so the server works
// no matter where it's launched from. APP_ENV defaults to "dev"; the prod box
// exports APP_ENV=prod once in its shell profile.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

export const APP_ENV = process.env.APP_ENV || 'dev';

export const envFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../env',
  `.env.${APP_ENV}`,
);

if (!fs.existsSync(envFile)) {
  throw new Error(
    `Missing env file for APP_ENV="${APP_ENV}": ${envFile}\n` +
      'Copy env/.env.example to env/.env.dev (or env/.env.prod) and fill in values.',
  );
}

dotenv.config({ path: envFile });
