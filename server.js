import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import livekitTokenHandler from './api/livekit-token.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

app.post('/api/livekit-token', livekitTokenHandler);

app.listen(PORT, () => {
  console.log(`Auth proxy listening on http://localhost:${PORT}`);
  console.log(`  POST /api/livekit-token`);
});
