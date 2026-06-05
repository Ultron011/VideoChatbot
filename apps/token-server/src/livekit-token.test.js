import { describe, it, expect, beforeEach } from 'vitest';
import { mintRoomToken } from './livekit-token.js';

describe('mintRoomToken', () => {
  beforeEach(() => {
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'devsecret-32chars-minimum-for-jwt-signing';
    process.env.LIVEKIT_URL = 'wss://example.livekit.cloud';
  });

  it('returns a JWT that decodes to the right room and identity', async () => {
    const { token, room, identity } = await mintRoomToken({ roomPrefix: 'visit' });

    expect(room).toMatch(/^visit-[a-z0-9]+$/);
    expect(identity).toMatch(/^user-[a-z0-9]+$/);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT
  });

  it('throws if credentials are missing', async () => {
    delete process.env.LIVEKIT_API_KEY;
    await expect(mintRoomToken({})).rejects.toThrow(/LIVEKIT_API_KEY/);
  });

  it('throws if secret is missing', async () => {
    delete process.env.LIVEKIT_API_SECRET;
    await expect(mintRoomToken({})).rejects.toThrow(/LIVEKIT_API_SECRET/);
  });

  it('throws if url is missing', async () => {
    delete process.env.LIVEKIT_URL;
    await expect(mintRoomToken({})).rejects.toThrow(/LIVEKIT_URL/);
  });

  it('embeds the named agent dispatch in the token', async () => {
    process.env.AGENT_NAME = 'test-agent';
    const { token } = await mintRoomToken({});
    delete process.env.AGENT_NAME;

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.roomConfig.agents).toHaveLength(1);
    expect(payload.roomConfig.agents[0].agentName).toBe('test-agent');
  });

  it('derives the agent name from APP_ENV when AGENT_NAME is unset', async () => {
    delete process.env.AGENT_NAME;
    process.env.APP_ENV = 'prod';
    const { token } = await mintRoomToken({});
    delete process.env.APP_ENV;

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.roomConfig.agents[0].agentName).toBe('ai-twin-prod');
  });
});
