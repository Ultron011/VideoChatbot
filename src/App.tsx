import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff, Phone, PhoneOff } from 'lucide-react';
import { RoomClient } from './livekit/RoomClient';

type CallState = 'INACTIVE' | 'CONNECTING' | 'LIVE';

const PRESET_AVATARS = [
  { id: 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a', name: 'Sandbox Test Avatar' },
  { id: '8175dfc2-7858-49d6-b5fa-0c135d1c4bad', name: 'Elenora (Tech Expert)' },
  { id: '7b888024-f8c9-4205-95e1-78ce01497bda', name: 'Shawn (Therapist)' },
  { id: '0930fd59-c8ad-434d-ad53-b391a1768720', name: 'Dexter (Lawyer)' },
  { id: '65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0', name: 'June (HR)' },
  { id: 'be747c9d-8e54-44b3-bcbf-c9b2c4fa1ce7', name: 'DrMalpani' }
];

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];

const CAPTION_FADE_MS = 6000;

export default function App() {
  const [stars] = useState(() =>
    Array.from({ length: 45 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: Math.random() * 2.5 + 0.5,
      delay: `${Math.random() * 8}s`,
      duration: `${Math.random() * 6 + 4}s`
    }))
  );

  const [selectedAvatar, setSelectedAvatar] = useState(
    PRESET_AVATARS.find(a => a.name.startsWith('June'))?.id ?? PRESET_AVATARS[1].id
  );
  const [selectedVoice, setSelectedVoice] = useState(
    OPENAI_VOICES.find(v => v === 'alloy') ?? OPENAI_VOICES[0]
  );
  const [state, setState] = useState<CallState>('INACTIVE');
  const [error, setError] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);

  const [captionsOn, setCaptionsOn] = useState(true);
  const [captionsVisible, setCaptionsVisible] = useState(false);
  const [liveAssistantCaption, setLiveAssistantCaption] = useState('');
  const [liveUserCaption, setLiveUserCaption] = useState('');
  const [showStatusPill, setShowStatusPill] = useState(true);

  const roomRef = useRef<RoomClient | null>(null);
  const avatarVideoRef = useRef<HTMLVideoElement>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const lobbyRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const lobby = lobbyRef.current;
    if (!lobby) return;

    const { clientX, clientY } = e;
    const { width, height, left, top } = lobby.getBoundingClientRect();

    // Mouse coordinates centered at 0 (from -0.5 to 0.5)
    const x = (clientX - left) / width - 0.5;
    const y = (clientY - top) / height - 0.5;

    // Set CSS custom properties directly on the element (avoiding React re-renders)
    lobby.style.setProperty('--mouse-x', x.toFixed(3));
    lobby.style.setProperty('--mouse-y', y.toFixed(3));

    // Calculate 3D tilt angles (max tilt of 8 degrees)
    const maxTilt = 8;
    const tiltRX = -(y * maxTilt);
    const tiltRY = x * maxTilt;

    lobby.style.setProperty('--tilt-rx', `${tiltRX.toFixed(2)}deg`);
    lobby.style.setProperty('--tilt-ry', `${tiltRY.toFixed(2)}deg`);
  };

  const handleMouseLeave = () => {
    const lobby = lobbyRef.current;
    if (!lobby) return;

    // Smoothly reset tilt and parallax variables
    lobby.style.setProperty('--mouse-x', '0');
    lobby.style.setProperty('--mouse-y', '0');
    lobby.style.setProperty('--tilt-rx', '0deg');
    lobby.style.setProperty('--tilt-ry', '0deg');
  };

  const captionFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const toggleCamera = () => (isCameraOn ? stopLocalCamera() : startLocalCamera());

  // Re-bind stream after a screen swap (lobby ↔ call) so the active <video> picks it up.
  useEffect(() => {
    if (isCameraOn && localStreamRef.current && userVideoRef.current) {
      userVideoRef.current.srcObject = localStreamRef.current;
      userVideoRef.current.play().catch(() => {});
    }
  }, [state, isCameraOn]);

  // Apply pending avatar stream once the video element is mounted in LIVE state.
  useEffect(() => {
    if (state === 'LIVE' && avatarVideoRef.current && pendingStreamRef.current) {
      avatarVideoRef.current.srcObject = pendingStreamRef.current;
      void avatarVideoRef.current.play().catch(() => {});
    }
  }, [state]);

  useEffect(() => {
    return () => {
      stopLocalCamera();
      void roomRef.current?.stop();
      if (captionFadeTimer.current) clearTimeout(captionFadeTimer.current);
    };
  }, []);

  // Auto-hide status pill 3s after entering LIVE state.
  useEffect(() => {
    if (state === 'LIVE') {
      setShowStatusPill(true);
      const t = setTimeout(() => setShowStatusPill(false), 3000);
      return () => clearTimeout(t);
    }
    setShowStatusPill(true);
  }, [state]);

  const showCaptionsNow = () => {
    setCaptionsVisible(true);
    if (captionFadeTimer.current) clearTimeout(captionFadeTimer.current);
    captionFadeTimer.current = setTimeout(() => setCaptionsVisible(false), CAPTION_FADE_MS);
  };

  const handleStartCall = async () => {
    if (state !== 'INACTIVE') return;
    setError(null);
    setState('CONNECTING');
    setLiveUserCaption('');
    setLiveAssistantCaption('');

    const room = new RoomClient({
      onAvatarVideo: (stream) => {
        pendingStreamRef.current = stream;
        if (avatarVideoRef.current) {
          avatarVideoRef.current.srcObject = stream;
          void avatarVideoRef.current.play().catch(() => {});
        }
      },
      onAvatarAudible: () => {
        setState((prev) => (prev === 'CONNECTING' ? 'LIVE' : prev));
      },
      onTranscript: (text, role, final) => {
        if (role === 'user') {
          setLiveUserCaption(text);
          if (final) showCaptionsNow();
        } else {
          setLiveAssistantCaption(text);
          showCaptionsNow();
        }
      },
      onDisconnected: () => { void handleEndCall(); },
      onError: (err) => {
        console.error(err);
        void handleEndCall();
      },
    });
    roomRef.current = room;

    try {
      await room.start(backendBase);
    } catch (err) {
      console.error(err);
      await handleEndCall();
    }
  };

  const handleEndCall = async () => {
    try { await roomRef.current?.stop(); } catch {}
    roomRef.current = null;
    pendingStreamRef.current = null;
    if (avatarVideoRef.current) avatarVideoRef.current.srcObject = null;
    setIsMuted(false);
    setState('INACTIVE');
    setLiveUserCaption('');
    setLiveAssistantCaption('');
  };

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      roomRef.current?.setMicMuted(next);
      return next;
    });
  };

  // Lobby (pre-call)
  const renderLobby = () => (
    <div
      ref={lobbyRef}
      className="lobby"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="stars-container">
        {stars.map(star => (
          <div
            key={star.id}
            className="star-particle"
            style={{
              left: star.left,
              top: star.top,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animationDelay: star.delay,
              animationDuration: star.duration
            }}
          />
        ))}
      </div>

      <div className="shapes-container">
        {/* Platinum Octahedron Wireframe */}
        <div className="floating-shape shape-platinum-octahedron">
          <svg viewBox="0 0 200 200" width="220" height="220" fill="none">
            <defs>
              <linearGradient id="platGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#a3a3a3" />
                <stop offset="100%" stopColor="#404040" />
              </linearGradient>
            </defs>
            <line x1="100" y1="20" x2="40" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
            <line x1="100" y1="20" x2="160" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
            <line x1="100" y1="20" x2="100" y2="100" stroke="url(#platGrad)" strokeWidth="0.8" opacity="0.6" />
            <polygon points="40,100 100,80 160,100 100,120" stroke="url(#platGrad)" strokeWidth="1" strokeLinejoin="round" />
            <line x1="100" y1="180" x2="40" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
            <line x1="100" y1="180" x2="160" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
            <line x1="100" y1="180" x2="100" y2="100" stroke="url(#platGrad)" strokeWidth="0.8" opacity="0.6" />
          </svg>
        </div>

        {/* Champagne Gold Rings Cluster */}
        <div className="floating-shape shape-gold-rings">
          <svg viewBox="0 0 200 200" width="180" height="180" fill="none">
            <defs>
              <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fbf3db" />
                <stop offset="50%" stopColor="#c5a880" />
                <stop offset="100%" stopColor="#866c4c" />
              </linearGradient>
            </defs>
            <ellipse cx="100" cy="100" rx="80" ry="30" stroke="url(#goldGrad)" strokeWidth="1.2" />
            <ellipse cx="100" cy="100" rx="60" ry="22" stroke="url(#goldGrad)" strokeWidth="1" strokeDasharray="5 3" opacity="0.7" />
            <ellipse cx="100" cy="100" rx="40" ry="15" stroke="url(#goldGrad)" strokeWidth="0.6" opacity="0.4" />
          </svg>
        </div>

        {/* Champagne Gold Orbital Sphere */}
        <div className="floating-shape shape-gold-sphere">
          <svg viewBox="0 0 200 200" width="140" height="140" fill="none">
            <defs>
              <linearGradient id="goldGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fbf3db" />
                <stop offset="50%" stopColor="#c5a880" />
                <stop offset="100%" stopColor="#866c4c" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="70" stroke="url(#goldGrad2)" strokeWidth="0.8" transform="rotate(30, 100, 100)" />
            <circle cx="100" cy="100" r="70" stroke="url(#goldGrad2)" strokeWidth="0.8" transform="rotate(-30, 100, 100)" strokeDasharray="8 4" opacity="0.7" />
            <circle cx="100" cy="100" r="70" stroke="url(#goldGrad2)" strokeWidth="0.5" transform="rotate(90, 100, 100)" opacity="0.4" />
          </svg>
        </div>

        {/* Platinum Ribbon/Helix */}
        <div className="floating-shape shape-platinum-helix">
          <svg viewBox="0 0 100 200" width="100" height="200" fill="none">
            <defs>
              <linearGradient id="platHelix" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" opacity="0.8" />
                <stop offset="50%" stopColor="#a3a3a3" opacity="0.4" />
                <stop offset="100%" stopColor="#404040" opacity="0.1" />
              </linearGradient>
            </defs>
            <path d="M50,10 C20,40 80,70 50,100 C20,130 80,160 50,190" stroke="url(#platHelix)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M50,10 C80,40 20,70 50,100 C80,130 20,160 50,190" stroke="url(#platHelix)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <header className="lobby-header">
        <div className="brand-mark">
          <div className="brand-dot" />
          <span className="brand-name">Liaison</span>
          <span className="brand-tag">Internal Beta</span>
        </div>
      </header>

      <div className="lobby-card">
        <div className="lobby-camera-area">
          <div className="lobby-preview">
            {isCameraOn ? (
              <video ref={userVideoRef} className="lobby-preview-video" playsInline autoPlay muted />
            ) : (
              <div className="lobby-preview-empty">
                <div className="monogram">Y</div>
                <span className="lobby-preview-label">Camera is off</span>
              </div>
            )}
          </div>
          <div className="lobby-preview-pills">
            <button
              className={`pill-toggle ${isMuted ? 'off' : ''}`}
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              type="button"
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              className={`pill-toggle ${!isCameraOn ? 'off' : ''}`}
              onClick={toggleCamera}
              aria-label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
              type="button"
            >
              {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
          </div>
        </div>

        <div className="lobby-form">
          <h1 className="lobby-title">Ready to join?</h1>
          <p className="lobby-sub">Pick an avatar and we’ll connect you.</p>

          <label className="field">
            <span className="field-label">Avatar</span>
            <select
              className="field-select"
              value={selectedAvatar}
              onChange={e => setSelectedAvatar(e.target.value)}
            >
              {PRESET_AVATARS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Voice</span>
            <select
              className="field-select"
              value={selectedVoice}
              onChange={e => setSelectedVoice(e.target.value)}
            >
              {OPENAI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>

          <button className="join-btn" onClick={handleStartCall} type="button">
            <Phone size={18} /> Join now
          </button>

          <p className="lobby-tip">You can interrupt the avatar any time — just start talking.</p>
        </div>
      </div>

      {error && <div className="error-toast">{error}</div>}
    </div>
  );

  // In-call view
  const renderCallView = () => {
    const showCaptions = state === 'LIVE' && captionsOn && captionsVisible && (liveAssistantCaption || liveUserCaption);
    const avatarName = (PRESET_AVATARS.find(a => a.id === selectedAvatar)?.name || 'Avatar').replace(/\s*\(.*?\)\s*$/, '');
    return (
      <div className="call-stage">
        <video ref={avatarVideoRef} className="avatar-video" playsInline autoPlay />

        {showStatusPill && (
          <div className={`status-pill ${state === 'LIVE' ? 'good' : 'connecting'}`}>
            <span className="status-dot" />
            <span>{state === 'LIVE' ? 'Connected' : 'Connecting…'}</span>
          </div>
        )}

        <div className="user-pip" onClick={toggleCamera} role="button" tabIndex={0}>
          {isCameraOn ? (
            <video ref={userVideoRef} className="user-pip-video" playsInline autoPlay muted />
          ) : (
            <div className="user-pip-monogram">Y</div>
          )}
        </div>

        {showCaptions && (
          <div className="captions">
            {liveUserCaption && (
              <div className="caption-line">
                <span className="caption-speaker">You</span>
                {liveUserCaption}
              </div>
            )}
            {liveAssistantCaption && (
              <div className="caption-line">
                <span className="caption-speaker">{avatarName}</span>
                {liveAssistantCaption}
              </div>
            )}
          </div>
        )}

        {state === 'CONNECTING' && (
          <div className="connecting-overlay">
            <div className="connecting-spinner" />
            <span>Connecting…</span>
          </div>
        )}

        <div className="controls-bar">
          <button
            className={`control-pill ${isMuted ? 'off' : ''}`}
            onClick={toggleMute}
            data-tooltip={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            type="button"
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            className={`control-pill ${!isCameraOn ? 'off' : ''}`}
            onClick={toggleCamera}
            data-tooltip={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
            aria-label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
            type="button"
          >
            {isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          <button
            className={`control-pill cc ${captionsOn ? '' : 'off'}`}
            onClick={() => setCaptionsOn(v => !v)}
            data-tooltip={captionsOn ? 'Hide captions' : 'Show captions'}
            aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
            type="button"
          >
            <span className="cc-letters">CC</span>
          </button>
          <button
            className="control-pill end"
            onClick={handleEndCall}
            data-tooltip="End call"
            aria-label="End call"
            type="button"
          >
            <PhoneOff size={20} />
          </button>
        </div>

        {error && <div className="error-toast">{error}</div>}
      </div>
    );
  };

  return (
    <div className="app-shell">
      {state === 'INACTIVE' ? renderLobby() : renderCallView()}
    </div>
  );

}
