import { useRef, useState, type RefObject } from 'react';
import { Mic, MicOff, Video, VideoOff, Phone } from 'lucide-react';

type Props = {
  agentName: string;
  isMuted: boolean;
  toggleMute: () => void;
  isCameraOn: boolean;
  toggleCamera: () => void;
  userVideoRef: RefObject<HTMLVideoElement | null>;
  onJoin: () => void;
  error: string | null;
};

export function Lobby({
  agentName,
  isMuted,
  toggleMute,
  isCameraOn,
  toggleCamera,
  userVideoRef,
  onJoin,
  error,
}: Props) {
  const [stars] = useState(() =>
    Array.from({ length: 45 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: Math.random() * 2.5 + 0.5,
      delay: `${Math.random() * 8}s`,
      duration: `${Math.random() * 6 + 4}s`,
    })),
  );

  const lobbyRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const lobby = lobbyRef.current;
    if (!lobby) return;
    const { clientX, clientY } = e;
    const { width, height, left, top } = lobby.getBoundingClientRect();
    const x = (clientX - left) / width - 0.5;
    const y = (clientY - top) / height - 0.5;
    lobby.style.setProperty('--mouse-x', x.toFixed(3));
    lobby.style.setProperty('--mouse-y', y.toFixed(3));
    const maxTilt = 8;
    lobby.style.setProperty('--tilt-rx', `${(-y * maxTilt).toFixed(2)}deg`);
    lobby.style.setProperty('--tilt-ry', `${(x * maxTilt).toFixed(2)}deg`);
  };

  const handleMouseLeave = () => {
    const lobby = lobbyRef.current;
    if (!lobby) return;
    lobby.style.setProperty('--mouse-x', '0');
    lobby.style.setProperty('--mouse-y', '0');
    lobby.style.setProperty('--tilt-rx', '0deg');
    lobby.style.setProperty('--tilt-ry', '0deg');
  };

  return (
    <div
      ref={lobbyRef}
      className="lobby"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="stars-container">
        {stars.map((star) => (
          <div
            key={star.id}
            className="star-particle"
            style={{
              left: star.left,
              top: star.top,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animationDelay: star.delay,
              animationDuration: star.duration,
            }}
          />
        ))}
      </div>

      <div className="shapes-container">
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
          <span className="brand-name">Dr. Malpani AI Twin</span>
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
          <p className="lobby-sub">Click below to start a video consult with {agentName}.</p>

          <button className="join-btn" onClick={onJoin} type="button">
            <Phone size={18} /> Join now
          </button>

          <p className="lobby-tip">You can interrupt the avatar any time — just start talking.</p>
        </div>
      </div>

      <a
        href="https://beyondchats.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="powered-by"
      >
        <span className="powered-by-label">Powered by</span>
        <svg className="powered-by-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1" y="1" width="14" height="12" rx="3" fill="currentColor" opacity="0.9"/>
          <path d="M4 13.5 L3 17 L7.5 14.5" fill="currentColor" opacity="0.9"/>
          <rect x="7" y="8" width="12" height="10" rx="3" fill="currentColor"/>
          <path d="M16 18 L17 21.5 L12.5 19" fill="currentColor"/>
        </svg>
        <span className="powered-by-name">BeyondChats</span>
      </a>

      {error && <div className="error-toast">{error}</div>}
    </div>
  );
}
