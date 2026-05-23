// src/realtime/openaiRealtime.ts
// Owns the WebRTC PeerConnection to OpenAI's GA Realtime API.
// Plays model audio directly (low-latency) and taps PCM frames via an AudioWorklet
// so they can be forwarded to HeyGen LiveAvatar for lipsync.

export type RealtimeEvents = {
  onAudioFrame?: (pcm: Int16Array) => void;
  onUserStartedSpeaking?: () => void;
  onUserStoppedSpeaking?: () => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscriptDelta?: (text: string) => void;
  onAssistantTranscriptDone?: (text: string) => void;
  onResponseDone?: () => void;
  onError?: (err: Error) => void;
};

export class OpenAIRealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private assistantTranscriptBuffer = '';
  private events: RealtimeEvents;

  constructor(events: RealtimeEvents) {
    this.events = events;
  }

  async start(backendBase: string): Promise<void> {
    const tokResp = await fetch(`${backendBase}/api/realtime-token`, { method: 'POST' });
    if (!tokResp.ok) throw new Error(`realtime-token: ${await tokResp.text()}`);
    const { ephemeral_key, model } = await tokResp.json();
    if (!ephemeral_key) throw new Error('No ephemeral_key in /api/realtime-token response');

    this.pc = new RTCPeerConnection();

    // Don't play OpenAI audio directly — LiveKit audio is used instead for lip sync.
    // We still tap PCM from the WebRTC track to drive HeyGen's lipsync pipeline.
    this.pc.ontrack = (e) => {
      this.attachPcmTap(e.streams[0]).catch((err) => this.events.onError?.(err));
    };

    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = (e) => this.handleServerEvent(e.data);
    this.dc.onopen = () => {
      // Silence the mic immediately — App unmutes it after the greeting finishes.
      // This prevents acoustic echo and spurious VAD triggers during greeting.
      this.setMicMuted(true);
      this.dc?.send(JSON.stringify({ type: 'response.create' }));
    };

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    for (const t of this.micStream.getAudioTracks()) this.pc.addTrack(t, this.micStream);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpResp = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ephemeral_key}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    });
    if (!sdpResp.ok) throw new Error(`OpenAI SDP exchange failed: ${sdpResp.status} ${await sdpResp.text()}`);

    const answer = { type: 'answer' as const, sdp: await sdpResp.text() };
    await this.pc.setRemoteDescription(answer);
  }

  private async attachPcmTap(stream: MediaStream): Promise<void> {
    const ctx = new AudioContext({ sampleRate: 24000 });
    await ctx.audioWorklet.addModule('/pcm-tap.worklet.js');
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-tap', {
      processorOptions: { targetSampleRate: 24000, batchSamples: 1440 } // 60ms @ 24kHz
    });
    node.port.onmessage = (e) => {
      const pcm = e.data as Int16Array;
      this.events.onAudioFrame?.(pcm);
    };
    src.connect(node);
    this.audioCtx = ctx;
    this.workletNode = node;
  }

  private handleServerEvent(raw: string): void {
    let evt: any;
    try { evt = JSON.parse(raw); } catch { return; }

    if (import.meta.env?.DEV) {
      if (evt.type?.startsWith('response.') || evt.type?.startsWith('conversation.')) {
        console.debug('[Realtime]', evt.type, evt.delta ?? evt.transcript ?? '');
      }
    }

    switch (evt.type) {
      case 'input_audio_buffer.speech_started':
        this.events.onUserStartedSpeaking?.();
        break;
      case 'input_audio_buffer.speech_stopped':
        this.events.onUserStoppedSpeaking?.();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (evt.transcript) this.events.onUserTranscript?.(evt.transcript);
        break;
      // Assistant streaming transcript — accept Beta and GA event names.
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
      case 'response.output_text.delta':
        if (evt.delta) {
          this.assistantTranscriptBuffer += evt.delta;
          this.events.onAssistantTranscriptDelta?.(evt.delta);
        }
        break;
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
      case 'response.output_text.done': {
        const text = evt.transcript || evt.text || this.assistantTranscriptBuffer;
        this.assistantTranscriptBuffer = '';
        if (text) this.events.onAssistantTranscriptDone?.(text);
        break;
      }
      case 'response.done':
        // Safety net: if `done` fires without a prior transcript.done, flush the buffer.
        if (this.assistantTranscriptBuffer) {
          const text = this.assistantTranscriptBuffer;
          this.assistantTranscriptBuffer = '';
          this.events.onAssistantTranscriptDone?.(text);
        }
        this.events.onResponseDone?.();
        break;
      case 'error':
        this.events.onError?.(new Error(evt.error?.message || JSON.stringify(evt)));
        break;
    }
  }

  cancelResponse(): void {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify({ type: 'response.cancel' }));
    }
  }

  setMicMuted(muted: boolean): void {
    if (!this.micStream) return;
    for (const t of this.micStream.getAudioTracks()) t.enabled = !muted;
    if (muted && this.dc?.readyState === 'open') {
      // Flush any audio already buffered on the server so the model doesn't
      // respond to speech that was captured just before the mute tap.
      this.dc.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
    }
  }

  sendTextMessage(text: string): void {
    if (this.dc?.readyState !== 'open') return;
    this.dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    }));
    this.dc.send(JSON.stringify({ type: 'response.create' }));
  }

  async stop(): Promise<void> {
    try { this.workletNode?.disconnect(); } catch {}
    try { await this.audioCtx?.close(); } catch {}
    this.workletNode = null;
    this.audioCtx = null;
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.dc = null;
    this.pc = null;
  }
}
