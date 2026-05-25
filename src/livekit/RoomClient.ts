// src/livekit/RoomClient.ts
// Thin wrapper around livekit-client Room that exposes only what App.tsx needs.
// All audio + video for the avatar arrive on one remote participant ("agent" or
// the avatar bot). Because the agent worker triggers generate_reply() after
// avatar.start(), the first track subscription IS the moment audio becomes audible.

import {
  Room,
  RoomEvent,
  RemoteTrack,
  RemoteParticipant,
  Track,
  ConnectionState,
} from 'livekit-client';

export type RoomClientEvents = {
  onAvatarVideo?: (stream: MediaStream) => void;
  onAvatarAudible?: () => void; // fires when avatar's audio element actually plays
  onTranscript?: (text: string, role: 'user' | 'assistant', final: boolean) => void;
  onDisconnected?: () => void;
  onError?: (err: Error) => void;
};

type TokenResponse = { token: string; room: string; identity: string; url: string };

export class RoomClient {
  private room: Room | null = null;
  private events: RoomClientEvents;
  private audioEl: HTMLAudioElement | null = null;
  private localAudibleFired = false;

  constructor(events: RoomClientEvents) {
    this.events = events;
  }

  async start(backendBase: string): Promise<void> {
    const resp = await fetch(`${backendBase}/api/livekit-token`, { method: 'POST' });
    if (!resp.ok) throw new Error(`livekit-token: ${await resp.text()}`);
    const { token, url } = (await resp.json()) as TokenResponse;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        this.events.onAvatarVideo?.(new MediaStream([track.mediaStreamTrack]));
      }
      if (track.kind === Track.Kind.Audio) {
        const el = new Audio();
        el.autoplay = true;
        (el as any).playsInline = true;
        el.srcObject = new MediaStream([track.mediaStreamTrack]);
        el.onplaying = () => {
          if (!this.localAudibleFired) {
            this.localAudibleFired = true;
            this.events.onAvatarAudible?.();
          }
        };
        el.play().catch(() => {});
        this.audioEl = el;
      }
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, _participant, _publication) => {
      for (const seg of segments) {
        // LiveKit Agents publishes transcription segments with `role` in metadata
        // or via participant identity. Treat the local participant's identity as user.
        const isUser = _participant?.identity === room.localParticipant.identity;
        this.events.onTranscript?.(seg.text, isUser ? 'user' : 'assistant', seg.final);
      }
    });

    room.on(RoomEvent.Disconnected, () => this.events.onDisconnected?.());
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === ConnectionState.Disconnected) this.events.onDisconnected?.();
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
  }

  setMicMuted(muted: boolean): void {
    void this.room?.localParticipant.setMicrophoneEnabled(!muted);
  }

  async stop(): Promise<void> {
    try {
      if (this.audioEl) {
        this.audioEl.srcObject = null;
        this.audioEl = null;
      }
      await this.room?.disconnect();
    } catch {}
    this.room = null;
    this.localAudibleFired = false;
  }
}
