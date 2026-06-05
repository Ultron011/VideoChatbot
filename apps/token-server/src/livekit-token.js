import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
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

  // The agent worker registers under an explicit name (ai-twin-dev /
  // ai-twin-prod, derived from APP_ENV), so each room must request it by name.
  const agentName =
    process.env.AGENT_NAME || `ai-twin-${process.env.APP_ENV || 'dev'}`;

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '15m' });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName })],
  });

  return { token: await at.toJwt(), room, identity, url };
}

// Express route handler. Thin wrapper over mintRoomToken so the minting logic
// stays a pure, unit-testable function.
export async function livekitTokenRoute(_req, res) {
  try {
    const result = await mintRoomToken({});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
