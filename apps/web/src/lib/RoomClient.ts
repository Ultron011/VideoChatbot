// Thin wrapper around livekit-client Room that exposes only what App.tsx needs.
// All audio + video for the avatar arrive on one remote participant.
//
// Mic gating: the local mic stays DISABLED at room-join. The agent worker
// publishes a `greeting_done` data message after the greeting finishes
// playing; we enable the mic at that point (unless the user has explicitly
// muted themselves via the UI). A 15s safety timer also unlatches in case
// the data message is lost.

import {
  Room,
  RoomEvent,
  RemoteTrack,
  Track,
  ConnectionState,
} from 'livekit-client';

export type RoomClientEvents = {
  onAvatarVideo?: (stream: MediaStream) => void;
  onAvatarAudible?: () => void;
  onTranscript?: (text: string, role: 'user' | 'assistant', final: boolean) => void;
  onDisconnected?: () => void;
  onError?: (err: Error) => void;
};

type TokenResponse = { token: string; room: string; identity: string; url: string };

const MIC_SAFETY_UNLATCH_MS = 15000;

// The avatar's source audio comes through quiet; an HTMLAudioElement can only
// play at its native level (volume maxes at 1.0). Route it through a Web Audio
// gain stage to amplify past that ceiling. 2.5 ≈ +8dB — loud and clear without
// clipping on normal speech. Lower toward 1.5 if it ever distorts.
const AVATAR_GAIN = 2.5;

export class RoomClient {
  private room: Room | null = null;
  private events: RoomClientEvents;
  private audioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private localAudibleFired = false;

  // User's intended mic state. Defaults to unmuted; mic still won't enable
  // until greetingDone is also true.
  private userWantsMuted = false;
  private greetingDone = false;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(events: RoomClientEvents) {
    this.events = events;
  }

  // Always same-origin: Vite proxies /api to the token server in dev, nginx
  // does the same in production.
  async start(): Promise<void> {
    const resp = await fetch('/api/livekit-token', { method: 'POST' });
    if (!resp.ok) throw new Error(`livekit-token: ${await resp.text()}`);
    const { token, url } = (await resp.json()) as TokenResponse;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) {
        this.events.onAvatarVideo?.(new MediaStream([track.mediaStreamTrack]));
      }
      if (track.kind === Track.Kind.Audio) {
        const stream = new MediaStream([track.mediaStreamTrack]);

        // Muted element: keeps the WebRTC track "live" so Chrome doesn't
        // silence the Web Audio graph (known createMediaStreamSource bug),
        // and gives us the onplaying signal. Actual sound comes from the
        // gain graph below, so this stays muted to avoid double playback.
        const el = new Audio();
        el.autoplay = true;
        el.muted = true;
        (el as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
        el.srcObject = stream;
        el.onplaying = () => {
          if (!this.localAudibleFired) {
            this.localAudibleFired = true;
            this.events.onAvatarAudible?.();
          }
        };
        el.play().catch(() => {});
        this.audioEl = el;

        // Amplify past the element's 1.0 ceiling, then run a brick-wall
        // limiter so the louder peaks get caught instead of clipping. Clean
        // gain doesn't change tone — the harsh "shouting" feeling comes from
        // clipping distortion, which the limiter prevents. Chain:
        //   source -> gain -> limiter -> speakers
        try {
          const Ctx = window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          this.audioCtx = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          gain.gain.value = AVATAR_GAIN;
          const limiter = ctx.createDynamicsCompressor();
          limiter.threshold.value = -3;  // start limiting just below 0dB
          limiter.knee.value = 0;        // hard knee = true limiter
          limiter.ratio.value = 20;      // ≥10:1 acts as a brick wall
          limiter.attack.value = 0.003;  // catch transients fast
          limiter.release.value = 0.25;
          source.connect(gain);
          gain.connect(limiter);
          limiter.connect(ctx.destination);
          void ctx.resume();
        } catch (err) {
          // Web Audio unavailable — fall back to plain element playback.
          console.warn('[RoomClient] gain boost failed, using unboosted audio', err);
          el.muted = false;
        }
      }
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, _participant) => {
      for (const seg of segments) {
        const isUser = _participant?.identity === room.localParticipant.identity;
        this.events.onTranscript?.(seg.text, isUser ? 'user' : 'assistant', seg.final);
      }
    });

    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== 'control') return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg?.type === 'greeting_done') this.handleGreetingDone();
      } catch {
        // ignore non-JSON payloads
      }
    });

    room.on(RoomEvent.Disconnected, () => this.events.onDisconnected?.());
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === ConnectionState.Disconnected) this.events.onDisconnected?.();
    });

    await room.connect(url, token);

    // Publish the mic track but keep it muted until greeting_done fires.
    // Publishing now (vs at greeting_done) avoids a renegotiation pause
    // mid-conversation.
    await room.localParticipant.setMicrophoneEnabled(false);

    this.safetyTimer = setTimeout(() => {
      if (!this.greetingDone) {
        console.warn('[RoomClient] greeting_done not received within 15s, unlatching mic');
        this.handleGreetingDone();
      }
    }, MIC_SAFETY_UNLATCH_MS);
  }

  private handleGreetingDone(): void {
    if (this.greetingDone) return;
    this.greetingDone = true;
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    this.applyMicState();
  }

  setMicMuted(muted: boolean): void {
    this.userWantsMuted = muted;
    this.applyMicState();
  }

  private applyMicState(): void {
    if (!this.room) return;
    const shouldEnable = this.greetingDone && !this.userWantsMuted;
    void this.room.localParticipant.setMicrophoneEnabled(shouldEnable);
  }

  async stop(): Promise<void> {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    try {
      if (this.audioEl) {
        this.audioEl.srcObject = null;
        this.audioEl = null;
      }
      if (this.audioCtx) {
        void this.audioCtx.close();
        this.audioCtx = null;
      }
      await this.room?.disconnect();
    } catch { /* already disconnected — ignore */ }
    this.room = null;
    this.localAudibleFired = false;
    this.greetingDone = false;
    this.userWantsMuted = false;
  }
}
