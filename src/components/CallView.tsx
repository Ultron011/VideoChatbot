import { type RefObject } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react';
import { StatusPill } from './StatusPill';
import { Captions } from './Captions';

type Props = {
  isLive: boolean;
  isConnecting: boolean;
  showStatusPill: boolean;
  avatarVideoRef: RefObject<HTMLVideoElement | null>;
  userVideoRef: RefObject<HTMLVideoElement | null>;
  isMuted: boolean;
  toggleMute: () => void;
  isCameraOn: boolean;
  toggleCamera: () => void;
  captionsOn: boolean;
  setCaptionsOn: (v: boolean | ((prev: boolean) => boolean)) => void;
  showCaptions: boolean;
  liveUserCaption: string;
  liveAssistantCaption: string;
  agentName: string;
  onEndCall: () => void;
  error: string | null;
  userSpeaking: boolean;
};

export function CallView({
  isLive,
  isConnecting,
  showStatusPill,
  avatarVideoRef,
  userVideoRef,
  isMuted,
  toggleMute,
  isCameraOn,
  toggleCamera,
  captionsOn,
  setCaptionsOn,
  showCaptions,
  liveUserCaption,
  liveAssistantCaption,
  agentName,
  onEndCall,
  error,
  userSpeaking,
}: Props) {
  return (
    <div className="call-stage">
      <video ref={avatarVideoRef} className="avatar-video" playsInline autoPlay />

      <StatusPill connected={isLive} visible={showStatusPill} />

      <div className="user-pip" onClick={toggleCamera} role="button" tabIndex={0}>
        {isCameraOn ? (
          <video ref={userVideoRef} className="user-pip-video" playsInline autoPlay muted />
        ) : (
          <div className="user-pip-monogram">Y</div>
        )}
      </div>

      {showCaptions && (
        <Captions
          userText={liveUserCaption}
          assistantText={liveAssistantCaption}
          assistantName={agentName}
        />
      )}

      {isConnecting && (
        <div className="connecting-overlay">
          <div className="connecting-spinner" />
          <span>Connecting…</span>
        </div>
      )}

      <div className="controls-bar">
        <button
          className={`control-pill mic-btn ${isMuted ? 'off mic-muted' : userSpeaking ? 'mic-speaking' : 'mic-active'}`}
          onClick={toggleMute}
          data-tooltip={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          type="button"
        >
          {isMuted ? (
            <MicOff size={20} />
          ) : userSpeaking ? (
            <span className="mic-dots">
              <span className="mic-dot" />
              <span className="mic-dot" />
              <span className="mic-dot" />
            </span>
          ) : (
            <Mic size={20} />
          )}
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
          onClick={() => setCaptionsOn((v) => !v)}
          data-tooltip={captionsOn ? 'Hide captions' : 'Show captions'}
          aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
          type="button"
        >
          <span className="cc-letters">CC</span>
        </button>
        <button
          className="control-pill end"
          onClick={onEndCall}
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
}
