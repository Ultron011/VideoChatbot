import { useState, useEffect, useRef } from 'react';
import {
  Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Settings,
  MessageSquare, Sparkles, AlertCircle, Info, Send,
  Maximize2, Minimize2
} from 'lucide-react';
import { OpenAIRealtimeClient } from './realtime/openaiRealtime';
import { LiveAvatarLiteClient } from './avatar/liveAvatarLite';

type CallState = 'INACTIVE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

const PRESET_AVATARS = [
  { id: 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a', name: 'Sandbox Test Avatar' },
  { id: '8175dfc2-7858-49d6-b5fa-0c135d1c4bad', name: 'Elenora (Tech Expert)' },
  { id: '7b888024-f8c9-4205-95e1-78ce01497bda', name: 'Shawn (Therapist)' },
  { id: '0930fd59-c8ad-434d-ad53-b391a1768720', name: 'Dexter (Lawyer)' },
  { id: '65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0', name: 'June (HR)' }
];

const OPENAI_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'
];

interface TranscriptItem {
  id: string;
  sender: 'user' | 'avatar';
  text: string;
}

export default function App() {
  const [selectedAvatar, setSelectedAvatar] = useState(PRESET_AVATARS[0].id);
  const [selectedVoice, setSelectedVoice] = useState(OPENAI_VOICES[0]);
  const [state, setState] = useState<CallState>('INACTIVE');
  const [error, setError] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const realtimeRef = useRef<OpenAIRealtimeClient | null>(null);
  const avatarRef = useRef<LiveAvatarLiteClient | null>(null);
  const assistantInProgressIdRef = useRef<string | null>(null);

  const [avatarAudioBars, setAvatarAudioBars] = useState<number[]>(new Array(15).fill(4));
  const [userAudioBars, setUserAudioBars] = useState<number[]>(new Array(15).fill(4));

  const backendBase = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

  const startLocalCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      localStreamRef.current = stream;
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
        userVideoRef.current.play().catch(() => {});
      }
      setIsCameraOn(true);
    } catch (e) {
      console.warn('Camera failed:', e);
      setIsCameraOn(false);
    }
  };

  const stopLocalCamera = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (userVideoRef.current) userVideoRef.current.srcObject = null;
    setIsCameraOn(false);
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  useEffect(() => {
    return () => {
      stopLocalCamera();
      realtimeRef.current?.stop();
      avatarRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (avatarSpeaking) {
      interval = setInterval(() => {
        setAvatarAudioBars(Array.from({ length: 15 }, () => Math.floor(Math.random() * 28) + 8));
      }, 80);
    } else {
      setTimeout(() => setAvatarAudioBars(new Array(15).fill(4)), 0);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [avatarSpeaking]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (userSpeaking) {
      interval = setInterval(() => {
        setUserAudioBars(Array.from({ length: 15 }, () => Math.floor(Math.random() * 28) + 8));
      }, 80);
    } else {
      setTimeout(() => setUserAudioBars(new Array(15).fill(4)), 0);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [userSpeaking]);

  const toggleCamera = () => isCameraOn ? stopLocalCamera() : startLocalCamera();

  const appendUserTranscript = (text: string) => {
    setTranscripts(prev => [...prev, { id: Math.random().toString(), sender: 'user', text }]);
  };

  const appendAssistantTranscriptDone = (text: string) => {
    setTranscripts(prev => {
      if (assistantInProgressIdRef.current) {
        const id = assistantInProgressIdRef.current;
        assistantInProgressIdRef.current = null;
        return prev.map(t => t.id === id ? { ...t, text } : t);
      }
      return [...prev, { id: Math.random().toString(), sender: 'avatar', text }];
    });
  };

  const appendAssistantDelta = (delta: string) => {
    setTranscripts(prev => {
      if (!assistantInProgressIdRef.current) {
        const newId = Math.random().toString();
        assistantInProgressIdRef.current = newId;
        return [...prev, { id: newId, sender: 'avatar', text: delta }];
      }
      const id = assistantInProgressIdRef.current;
      return prev.map(t => t.id === id ? { ...t, text: t.text + delta } : t);
    });
  };

  const handleStartCall = async () => {
    setError(null);
    setState('CONNECTING');
    setTranscripts([]);

    const avatar = new LiveAvatarLiteClient({
      onConnected: () => console.log('[Avatar] WS connected'),
      onAvatarSpeakStarted: () => setAvatarSpeaking(true),
      onAvatarSpeakEnded: () => setAvatarSpeaking(false),
      onVideoTrack: (ms) => {
        if (videoRef.current) {
          videoRef.current.srcObject = ms;
          videoRef.current.play().catch(() => {});
        }
      },
      onError: (e) => setError(e.message)
    });

    const realtime = new OpenAIRealtimeClient({
      onAudioFrame: (pcm) => avatar.speak(pcm),
      onUserStartedSpeaking: () => {
        setUserSpeaking(true);
        avatar.interrupt();
      },
      onUserStoppedSpeaking: () => setUserSpeaking(false),
      onUserTranscript: (text) => appendUserTranscript(text),
      onAssistantTranscriptDelta: (delta) => appendAssistantDelta(delta),
      onAssistantTranscriptDone: (text) => appendAssistantTranscriptDone(text),
      onResponseDone: () => avatar.speakEnd(),
      onError: (e) => setError(e.message)
    });

    realtimeRef.current = realtime;
    avatarRef.current = avatar;

    try {
      await Promise.all([
        avatar.start(backendBase, selectedAvatar),
        realtime.start(backendBase)
      ]);
      setState('CONNECTED');
    } catch (e: unknown) {
      console.error('Start call failed:', e);
      setError((e as Error).message || 'Failed to start call');
      setState('INACTIVE');
      await realtime.stop();
      await avatar.stop();
      realtimeRef.current = null;
      avatarRef.current = null;
    }
  };

  const handleEndCall = async () => {
    await realtimeRef.current?.stop();
    await avatarRef.current?.stop();
    realtimeRef.current = null;
    avatarRef.current = null;
    setState('INACTIVE');
    setAvatarSpeaking(false);
    setUserSpeaking(false);
    setIsImmersive(false);
    setShowSidebar(true);
  };

  const toggleMute = () => {
    const next = !isMuted;
    realtimeRef.current?.setMicMuted(next);
    setIsMuted(next);
  };

  const handleSendMessage = () => {
    if (!textInput.trim() || !realtimeRef.current) return;
    appendUserTranscript(textInput);
    realtimeRef.current.sendTextMessage(textInput);
    setTextInput('');
  };

  return (
    <div className={isImmersive ? 'immersive-active' : ''}>
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-pulse"></div>
          <h1 className="app-title">LiveCall AI</h1>
          <span className="app-subtitle">REALTIME • OPENAI + HEYGEN LITE</span>
        </div>
        {state !== 'INACTIVE' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className={`status-dot ${state === 'CONNECTED' ? 'active' : 'connecting'}`}></div>
            <span className="status-text">{state}</span>
          </div>
        )}
      </header>

      <main className="app-container">
        {error && (
          <div className="api-warning-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={18} /><strong>Connection Error</strong>
            </div>
            <p>{error}</p>
          </div>
        )}

        <div className="dashboard-grid">
          <section className="settings-panel">
            <h2 className="panel-title"><Settings size={18} /> Call Setup</h2>

            <div className="settings-section">
              <label className="settings-label">Avatar</label>
              <div className="select-wrapper">
                <select
                  className="custom-select"
                  value={selectedAvatar}
                  onChange={e => setSelectedAvatar(e.target.value)}
                  disabled={state !== 'INACTIVE'}
                >
                  {PRESET_AVATARS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            <div className="settings-section">
              <label className="settings-label">Voice (OpenAI Realtime)</label>
              <div className="select-wrapper">
                <select
                  className="custom-select"
                  value={selectedVoice}
                  onChange={e => setSelectedVoice(e.target.value)}
                  disabled={state !== 'INACTIVE'}
                >
                  {OPENAI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                Voice is currently set server-side via OPENAI_REALTIME_VOICE. UI selection takes effect on next server restart.
              </p>
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
              <Info size={16} style={{ flexShrink: 0, color: 'var(--accent-teal)' }} />
              <span>
                Voice pipeline runs on OpenAI Realtime (GA). Avatar runs in HeyGen LITE mode for lipsync only. Barge-in is supported.
              </span>
            </div>
          </section>

          <section className="call-container">
            <div className="video-stage">
              <video ref={videoRef} className="avatar-video" playsInline autoPlay />

              <div className={`user-pip ${isImmersive && showSidebar ? 'shifted' : ''}`} onClick={toggleCamera}>
                <video
                  ref={userVideoRef}
                  className="user-video"
                  playsInline autoPlay muted
                  style={{ display: isCameraOn ? 'block' : 'none' }}
                />
                {!isCameraOn && (
                  <div className="user-pip-fallback">
                    <VideoOff size={18} /><span>Camera Off</span>
                  </div>
                )}
              </div>

              {state === 'CONNECTING' && (
                <div className="screen-overlay">
                  <div className="overlay-icon-container">
                    <div className="overlay-pulse-ring"></div>
                    <div className="overlay-pulse-ring-slow"></div>
                    <div className="overlay-icon-circle"><Sparkles size={32} /></div>
                  </div>
                  <h3 className="overlay-title">Connecting</h3>
                  <p className="overlay-desc">Opening OpenAI Realtime WebRTC + HeyGen LITE channels...</p>
                </div>
              )}

              {state === 'INACTIVE' && (
                <div className="screen-overlay">
                  <div className="overlay-icon-container">
                    <div className="overlay-icon-circle" style={{ background: 'var(--bg-tertiary)' }}>
                      <Phone size={32} style={{ color: 'var(--text-secondary)' }} />
                    </div>
                  </div>
                  <h3 className="overlay-title">Ready for Conversation</h3>
                  <p className="overlay-desc">Click Start Call to begin a live voice session.</p>
                  <button onClick={handleStartCall} className="control-btn start-call">
                    <Phone size={18} /> Start Call Session
                  </button>
                </div>
              )}
            </div>

            {state !== 'INACTIVE' && (
              <div className="call-controls-bar">
                <button onClick={toggleMute} className={`control-btn ${isMuted ? 'muted' : ''}`} data-tooltip={isMuted ? 'Unmute' : 'Mute'}>
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <button onClick={toggleCamera} className={`control-btn ${isCameraOn ? 'active' : ''}`} data-tooltip={isCameraOn ? 'Camera Off' : 'Camera On'}>
                  {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
                {isImmersive && (
                  <button onClick={() => setShowSidebar(!showSidebar)} className={`control-btn ${showSidebar ? 'active' : ''}`} data-tooltip={showSidebar ? 'Hide Chat' : 'Show Chat'}>
                    <MessageSquare size={18} />
                  </button>
                )}
                <button onClick={() => setIsImmersive(!isImmersive)} className={`control-btn ${isImmersive ? 'active' : ''}`} data-tooltip={isImmersive ? 'Exit Full Screen' : 'Full Screen'}>
                  {isImmersive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button onClick={handleEndCall} className="control-btn end-call" data-tooltip="Hang Up">
                  <PhoneOff size={18} /> Hang Up
                </button>
              </div>
            )}

            <div className={`call-details-pane ${isImmersive && !showSidebar ? 'hidden' : ''}`}>
              <div className="transcript-box">
                <div className="transcript-header">
                  <h4 className="transcript-title"><MessageSquare size={16} /> Live Transcript</h4>
                  {state === 'CONNECTED' && <span className="badge-live">Live</span>}
                </div>
                <div className="transcript-list">
                  {transcripts.length === 0 ? (
                    <div className="transcript-placeholder">
                      <span>Speak to the avatar or type a message. Transcription will appear here.</span>
                    </div>
                  ) : (
                    transcripts.map(t => (
                      <div key={t.id} className={`transcript-item ${t.sender === 'user' ? 'user-bubble' : 'avatar-bubble'}`}>
                        <span className={`transcript-sender ${t.sender}`}>{t.sender === 'user' ? 'You' : 'Avatar'}</span>
                        <p className="transcript-text">{t.text}</p>
                      </div>
                    ))
                  )}
                  <div ref={transcriptEndRef} />
                </div>

                {state === 'CONNECTED' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input
                      type="text"
                      className="custom-select"
                      placeholder="Type a message (also speaks via Realtime)..."
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                      style={{ flex: 1 }}
                    />
                    <button onClick={handleSendMessage} className="control-btn active" style={{ width: 42, height: 42, borderRadius: 12 }}>
                      <Send size={16} />
                    </button>
                  </div>
                )}
              </div>

              <div className="waveform-box">
                <div className="visualizer-card">
                  <div className="visualizer-label">
                    <span>AVATAR AUDIO ENERGY</span>
                    <span style={{ color: 'var(--accent-purple)' }}>{avatarSpeaking ? 'SPEAKING' : 'IDLE'}</span>
                  </div>
                  <div className="visualizer-bars-container">
                    {avatarAudioBars.map((h, i) => (
                      <div key={i} className={`visualizer-bar ${avatarSpeaking ? 'active-avatar' : ''}`} style={{ height: `${h}px` }} />
                    ))}
                  </div>
                </div>

                <div className="visualizer-card">
                  <div className="visualizer-label">
                    <span>YOUR VOICE INPUT</span>
                    <span style={{ color: isMuted ? 'var(--text-muted)' : userSpeaking ? 'var(--accent-teal)' : '#22c55e' }}>
                      {isMuted ? 'MUTED' : userSpeaking ? 'TALKING' : 'LISTENING'}
                    </span>
                  </div>
                  <div className="visualizer-bars-container">
                    {userAudioBars.map((h, i) => (
                      <div key={i} className={`visualizer-bar ${userSpeaking ? 'active-user' : ''}`} style={{ height: `${h}px` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
