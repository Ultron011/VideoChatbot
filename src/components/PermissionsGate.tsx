import { useState } from 'react';
import { Mic, Video, ShieldCheck, ShieldX, ArrowRight, RefreshCw } from 'lucide-react';

type Status = 'idle' | 'requesting' | 'denied';

type Props = {
  onGranted: () => void;
};

export function PermissionsGate({ onGranted }: Props) {
  const [status, setStatus] = useState<Status>('idle');

  const requestAccess = async () => {
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
      onGranted();
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
              Your browser blocked camera and microphone access. Follow these steps to allow it, then refresh.
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
          <h2 className="perm-title">Camera & microphone access</h2>
          <p className="perm-body">
            To speak with Dr. Malpani's AI nurse, we need access to your microphone and camera before you join.
          </p>
        </div>

        <div className="perm-items">
          <div className="perm-item">
            <div className="perm-item-icon">
              <Mic size={19} />
            </div>
            <div className="perm-item-text">
              <span className="perm-item-label">Microphone</span>
              <span className="perm-item-desc">So the nurse can hear you speak</span>
            </div>
          </div>
          <div className="perm-item">
            <div className="perm-item-icon">
              <Video size={19} />
            </div>
            <div className="perm-item-text">
              <span className="perm-item-label">Camera</span>
              <span className="perm-item-desc">Your selfie preview during the call</span>
            </div>
          </div>
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
              Allow access
            </>
          )}
        </button>

        <p className="lobby-tip">Your camera and microphone are never recorded or stored by us.</p>
      </div>
    </div>
  );
}
