import { useState } from 'react';
import { Mic, MicOff, Video, VideoOff, ShieldCheck, ShieldX, ArrowRight, RefreshCw } from 'lucide-react';

type Status = 'idle' | 'requesting' | 'denied';

type Props = {
  onGranted: (micEnabled: boolean, cameraEnabled: boolean) => void;
};

export function PermissionsGate({ onGranted }: Props) {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<Status>('idle');

  const requestAccess = async () => {
    setStatus('requesting');
    try {
      if (micOn || cameraOn) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: micOn,
          video: cameraOn,
        });
        stream.getTracks().forEach((t) => t.stop());
      }
      onGranted(micOn, cameraOn);
    } catch {
      setStatus('denied');
    }
  };

  if (status === 'denied') {
    return (
      <div className="perm-overlay">
        <div className="perm-card">
          <div className="perm-icon-wrap denied">
            <ShieldX size={28} />
          </div>

          <div className="perm-text-block">
            <h2 className="perm-title">Access was blocked</h2>
            <p className="perm-body">
              Your browser blocked access. Follow the steps below, then refresh.
            </p>
          </div>

          <div className="perm-steps">
            <div className="perm-step">
              <span className="perm-step-num">1</span>
              <span>Tap the <strong>lock</strong> or <strong>settings</strong> icon in your browser's address bar</span>
            </div>
            <div className="perm-step">
              <span className="perm-step-num">2</span>
              <span>Set <strong>Camera</strong> and <strong>Microphone</strong> to <strong>Allow</strong></span>
            </div>
            <div className="perm-step">
              <span className="perm-step-num">3</span>
              <span>Refresh this page and try again</span>
            </div>
          </div>

          <button className="join-btn" onClick={() => window.location.reload()} type="button">
            <RefreshCw size={17} />
            Refresh page
          </button>

          <button className="perm-try-again" onClick={() => setStatus('idle')} type="button">
            Try again without refreshing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="perm-overlay">
      <div className="perm-card">
        <div className="perm-icon-wrap">
          <ShieldCheck size={28} />
        </div>

        <div className="perm-text-block">
          <h2 className="perm-title">Set up your devices</h2>
          <p className="perm-body">
            Choose what to enable for your consultation. You can change these during the call.
          </p>
        </div>

        <div className="perm-items">
          <button
            className={`perm-item perm-item-btn ${!micOn ? 'perm-item-off' : ''}`}
            onClick={() => setMicOn((v) => !v)}
            type="button"
            aria-pressed={micOn}
          >
            <div className={`perm-item-icon ${!micOn ? 'off' : ''}`}>
              {micOn ? <Mic size={19} /> : <MicOff size={19} />}
            </div>
            <div className="perm-item-text">
              <span className="perm-item-label">Microphone</span>
              <span className="perm-item-desc">
                {micOn ? 'Speak to the nurse' : "You'll join muted — tap mic to enable"}
              </span>
            </div>
            <div className={`perm-toggle-pill ${micOn ? 'on' : ''}`} aria-hidden>
              <div className="perm-toggle-thumb" />
            </div>
          </button>

          <button
            className={`perm-item perm-item-btn ${!cameraOn ? 'perm-item-off' : ''}`}
            onClick={() => setCameraOn((v) => !v)}
            type="button"
            aria-pressed={cameraOn}
          >
            <div className={`perm-item-icon ${!cameraOn ? 'off' : ''}`}>
              {cameraOn ? <Video size={19} /> : <VideoOff size={19} />}
            </div>
            <div className="perm-item-text">
              <span className="perm-item-label">Camera</span>
              <span className="perm-item-desc">
                {cameraOn ? 'Your selfie preview during the call' : "Camera off — tap video to enable"}
              </span>
            </div>
            <div className={`perm-toggle-pill ${cameraOn ? 'on' : ''}`} aria-hidden>
              <div className="perm-toggle-thumb" />
            </div>
          </button>
        </div>

        <button
          className="join-btn"
          onClick={requestAccess}
          disabled={status === 'requesting'}
          type="button"
        >
          {status === 'requesting' ? (
            <>
              <span className="perm-spinner" />
              Waiting for permission…
            </>
          ) : (
            <>
              <ArrowRight size={18} />
              Continue
            </>
          )}
        </button>

        <p className="lobby-tip">Your devices are never recorded or stored by us.</p>
      </div>
    </div>
  );
}
