// src/avatar/liveAvatarLite.ts
// Subscribes to the avatar's LiveKit room for video and drives lipsync by
// pushing PCM 16-bit 24kHz audio over a WebSocket via `agent.speak` commands.

import { Room, RoomEvent, RemoteTrack, RemoteParticipant, Track } from 'livekit-client';

export type LiteAvatarEvents = {
  onConnected?: () => void;
  onAvatarSpeakStarted?: () => void;
  onAvatarSpeakEnded?: () => void;
  onAvatarAudioPlaying?: () => void;
  onVideoTrack?: (stream: MediaStream) => void;
  onError?: (err: Error) => void;
};

export class LiveAvatarLiteClient {
  private room: Room | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private events: LiteAvatarEvents;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private pendingAudio: string[] = [];
  private liveKitAudioEl: HTMLAudioElement | null = null;
  private _onSessionReady: (() => void) | null = null;
  private _audioPlayingFired = false;

  constructor(events: LiteAvatarEvents) {
    this.events = events;
  }

  async start(backendBase: string, avatarId: string): Promise<void> {
    const resp = await fetch(`${backendBase}/api/avatar-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_id: avatarId })
    });
    if (!resp.ok) throw new Error(`avatar-session: ${await resp.text()}`);
    const { livekit_url, livekit_token, ws_url } = await resp.json();
    if (!livekit_url || !livekit_token || !ws_url) {
      throw new Error('avatar-session response missing livekit_url/livekit_token/ws_url');
    }

    this.room = new Room({ adaptiveStream: true, dynacast: true });
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        const ms = new MediaStream([track.mediaStreamTrack]);
        this.events.onVideoTrack?.(ms);
      }
      if (track.kind === Track.Kind.Audio) {
        const el = new Audio();
        el.autoplay = true;
        (el as any).playsInline = true;
        el.srcObject = new MediaStream([track.mediaStreamTrack]);
        // Fire once when audio is actually audible in the browser —
        // this is later than HeyGen's speak_started due to LiveKit buffering.
        el.onplaying = () => {
          if (!this._audioPlayingFired) {
            this._audioPlayingFired = true;
            this.events.onAvatarAudioPlaying?.();
          }
        };
        el.play().catch(() => {});
        this.liveKitAudioEl = el;
      }
    });

    await this.room.connect(livekit_url, livekit_token);

    this.ws = new WebSocket(ws_url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => this.handleWsMessage(e.data);
    this.ws.onerror = () => this.events.onError?.(new Error('LiveAvatar WS error'));
    this.ws.onclose = () => { this.connected = false; };

    // Wait until the session is truly ready (session.state_updated: connected),
    // not just WS open. This ensures pendingAudio is flushed before start() resolves,
    // so the call view shows only after the greeting audio is already flowing to HeyGen.
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('No WS'));
      this._onSessionReady = resolve;
      this.ws.onopen = () => {};
      setTimeout(() => reject(new Error('LiveAvatar session ready timeout')), 20000);
    });

    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'session.keep_alive' }));
      }
    }, 4 * 60 * 1000);
  }

  private handleWsMessage(data: any): void {
    if (typeof data !== 'string') return;
    let evt: any;
    try { evt = JSON.parse(data); } catch { return; }
    switch (evt.type) {
      case 'session.state_updated':
        if (evt.state === 'connected') {
          this.connected = true;
          for (const a of this.pendingAudio) this.sendSpeakRaw(a);
          this.pendingAudio = [];
          this.events.onConnected?.();
          this._onSessionReady?.();
          this._onSessionReady = null;
        } else if (evt.state === 'closed') {
          this.connected = false;
        }
        break;
      case 'agent.speak_started':
        this.events.onAvatarSpeakStarted?.();
        break;
      case 'agent.speak_ended':
        this.events.onAvatarSpeakEnded?.();
        break;
    }
  }

  speak(pcm: Int16Array): void {
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(binary);

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingAudio.push(b64);
      return;
    }
    if (this.ws.bufferedAmount > 1_000_000) {
      console.warn('[LiveAvatar] WS backpressure — dropping chunk + interrupting');
      this.interrupt();
      return;
    }
    this.sendSpeakRaw(b64);
  }

  private sendSpeakRaw(b64: string): void {
    this.ws?.send(JSON.stringify({ type: 'agent.speak', audio: b64 }));
  }

  speakEnd(): void {
    this.ws?.send(JSON.stringify({ type: 'agent.speak_end' }));
  }

  interrupt(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent.interrupt' }));
    }
  }

  async stop(): Promise<void> {
    if (this.keepAliveTimer) { clearInterval(this.keepAliveTimer); this.keepAliveTimer = null; }
    try { this.ws?.close(); } catch {}
    this.ws = null;
    try { await this.room?.disconnect(); } catch {}
    this.room = null;
    this.connected = false;
    this.pendingAudio = [];
    this._audioPlayingFired = false;
    if (this.liveKitAudioEl) {
      this.liveKitAudioEl.srcObject = null;
      this.liveKitAudioEl = null;
    }
  }
}
