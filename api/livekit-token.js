import { AccessToken } from 'livekit-server-sdk';
import { randomBytes } from 'node:crypto';

function rid(prefix) {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

export async function mintRoomToken({ roomPrefix = 'visit', identityPrefix = 'user' } = {}) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey) throw new Error('LIVEKIT_API_KEY missing on server');
  if (!apiSecret) throw new Error('LIVEKIT_API_SECRET missing on server');
  if (!url) throw new Error('LIVEKIT_URL missing on server');

  const room = rid(roomPrefix);
  const identity = rid(identityPrefix);

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '15m' });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return { token: await at.toJwt(), room, identity, url };
}

export default async function handler(req, res) {
  try {
    const result = await mintRoomToken({});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
