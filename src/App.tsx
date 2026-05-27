import { useEffect, useRef, useState } from 'react';
import { RoomClient } from './lib/RoomClient';
import { useLocalCamera } from './hooks/useLocalCamera';
import { useRingTone } from './hooks/useRingTone';
import { useVoiceActivity } from './hooks/useVoiceActivity';
import { Lobby } from './components/Lobby';
import { CallView } from './components/CallView';
import { PermissionsGate } from './components/PermissionsGate';
import { LandingPage } from './LandingPage';

type CallState = 'INACTIVE' | 'CONNECTING' | 'LIVE';

const AGENT_DISPLAY_NAME = "Dr. Malpani's AI Nurse";
const CAPTION_FADE_MS = 6000;

const backendBase =
  window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

export default function App() {
  const [state, setState] = useState<CallState>('INACTIVE');
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [showLobby, setShowLobby] = useState(() => {
    return window.location.search.includes('start=true');
  });
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);

  // Sync state with browser navigation
  useEffect(() => {
    const handlePopState = () => {
      setShowLobby(window.location.search.includes('start=true'));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleStartLobby = () => {
    setShowLobby(true);
    window.history.pushState({}, '', '/?start=true');
  };

  const [captionsOn, setCaptionsOn] = useState(true);
  const [captionsVisible, setCaptionsVisible] = useState(false);
  const [liveAssistantCaption, setLiveAssistantCaption] = useState('');
  const [liveUserCaption, setLiveUserCaption] = useState('');
  const [showStatusPill, setShowStatusPill] = useState(true);

  const roomRef = useRef<RoomClient | null>(null);
  const avatarVideoRef = useRef<HTMLVideoElement>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const captionFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const camera = useLocalCamera();
  useRingTone(state === 'CONNECTING');
  const userSpeaking = useVoiceActivity(state === 'LIVE');

  const handlePermissionsGranted = (micEnabled: boolean, cameraEnabled: boolean) => {
    setPermissionsGranted(true);
    if (!micEnabled) {
      isMutedRef.current = true;
      setIsMuted(true);
    }
    if (cameraEnabled) void camera.start();
  };

  // Re-bind the camera stream after lobby ↔ call swap.
  useEffect(() => {
    camera.rebind();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending avatar stream once the <video> mounts in LIVE state.
  useEffect(() => {
    if (state === 'LIVE' && avatarVideoRef.current && pendingStreamRef.current) {
      avatarVideoRef.current.srcObject = pendingStreamRef.current;
      void avatarVideoRef.current.play().catch(() => {});
    }
  }, [state]);

  // Auto-hide status pill 3s after entering LIVE state.
  useEffect(() => {
    if (state === 'LIVE') {
      setShowStatusPill(true);
      const t = setTimeout(() => setShowStatusPill(false), 3000);
      return () => clearTimeout(t);
    }
    setShowStatusPill(true);
  }, [state]);

  useEffect(() => {
    return () => {
      void roomRef.current?.stop();
      if (captionFadeTimer.current) clearTimeout(captionFadeTimer.current);
    };
  }, []);

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
      onDisconnected: () => {
        void handleEndCall();
      },
      onError: (err) => {
        console.error(err);
        void handleEndCall();
      },
    });
    roomRef.current = room;
    if (isMutedRef.current) room.setMicMuted(true);

    try {
      await room.start(backendBase);
    } catch (err) {
      console.error(err);
      await handleEndCall();
    }
  };

  const handleEndCall = async () => {
    try {
      await roomRef.current?.stop();
    } catch {}
    roomRef.current = null;
    pendingStreamRef.current = null;
    if (avatarVideoRef.current) avatarVideoRef.current.srcObject = null;
    isMutedRef.current = false;
    setIsMuted(false);
    setState('INACTIVE');
    setLiveUserCaption('');
    setLiveAssistantCaption('');
  };

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      roomRef.current?.setMicMuted(next);
      return next;
    });
  };

  const showCaptions =
    state === 'LIVE' &&
    captionsOn &&
    captionsVisible &&
    !!(liveAssistantCaption || liveUserCaption);

  return (
    <div className="app-shell">
      {state === 'INACTIVE' ? (
        showLobby ? (
          <>
            <Lobby
              agentName={AGENT_DISPLAY_NAME}
              isMuted={isMuted}
              toggleMute={toggleMute}
              isCameraOn={camera.isCameraOn}
              toggleCamera={camera.toggle}
              userVideoRef={camera.userVideoRef}
              onJoin={handleStartCall}
              error={error}
            />
            {!permissionsGranted && (
              <PermissionsGate onGranted={handlePermissionsGranted} />
            )}
          </>
        ) : (
          <LandingPage onStartCall={handleStartLobby} />
        )
      ) : (
        <CallView
          isLive={state === 'LIVE'}
          isConnecting={state === 'CONNECTING'}
          showStatusPill={showStatusPill}
          avatarVideoRef={avatarVideoRef}
          userVideoRef={camera.userVideoRef}
          isMuted={isMuted}
          toggleMute={toggleMute}
          isCameraOn={camera.isCameraOn}
          toggleCamera={camera.toggle}
          captionsOn={captionsOn}
          setCaptionsOn={setCaptionsOn}
          showCaptions={showCaptions}
          liveUserCaption={liveUserCaption}
          liveAssistantCaption={liveAssistantCaption}
          agentName={AGENT_DISPLAY_NAME}
          onEndCall={handleEndCall}
          error={error}
          userSpeaking={userSpeaking}
        />
      )}
    </div>
  );
}
