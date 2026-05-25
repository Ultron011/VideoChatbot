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
});
