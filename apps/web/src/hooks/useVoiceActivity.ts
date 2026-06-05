import { useEffect, useRef, useState } from 'react';

const RMS_THRESHOLD = 12;  // 0–100 scale
const TRAIL_MS      = 600; // stay "speaking" for this long after volume drops

/**
 * Real-time voice activity detection via Web Audio AnalyserNode.
 * Opens its own getUserMedia audio stream so it works independently of
 * LiveKit's mic management. `active` should be true while the call is live.
 */
export function useVoiceActivity(active: boolean): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const rafRef     = useRef<number>(0);
  const trailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(rafRef.current);
      if (trailTimer.current) clearTimeout(trailTimer.current);
      // No setIsSpeaking(false) here: the cleanup below and the initial
      // useState(false) already guarantee it's false whenever inactive.
      return;
    }

    let running = true;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((s) => {
        if (!running) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!running) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length) * 100;

          if (rms > RMS_THRESHOLD) {
            if (trailTimer.current) { clearTimeout(trailTimer.current); trailTimer.current = null; }
            setIsSpeaking(true);
          } else if (!trailTimer.current) {
            trailTimer.current = setTimeout(() => {
              setIsSpeaking(false);
              trailTimer.current = null;
            }, TRAIL_MS);
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => { /* mic denied — fail silently */ });

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      if (trailTimer.current) { clearTimeout(trailTimer.current); trailTimer.current = null; }
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      setIsSpeaking(false);
    };
  }, [active]);

  return isSpeaking;
}
