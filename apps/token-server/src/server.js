// env.js must be imported before anything reads process.env — it loads the
// shared env/.env.${APP_ENV} file from the repo root.
import { APP_ENV } from './env.js';
import express from 'express';
import cors from 'cors';
import { livekitTokenRoute } from './livekit-token.js';

const app = express();
const PORT = process.env.PORT || 3000;
// Bind to loopback only: this service is reachable solely via the nginx
// reverse proxy, never directly from the public internet.
const HOST = process.env.HOST || '127.0.0.1';
// Same-origin in production (frontend served from the same host by nginx),
// so lock CORS down to the known origin. Override via ALLOWED_ORIGIN if needed.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ai-twin.drmalpani.com';

app.disable('x-powered-by');
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

app.post('/api/livekit-token', livekitTokenRoute);

app.listen(PORT, HOST, () => {
  console.log(`LiveKit token server listening on http://${HOST}:${PORT} (APP_ENV=${APP_ENV})`);
  console.log(`  POST /api/livekit-token`);
});
