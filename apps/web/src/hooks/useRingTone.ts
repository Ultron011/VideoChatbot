import { useEffect, useRef } from 'react';

// Plays a gentle dual-tone phone ring (440 Hz + 480 Hz) while `active` is true.
// Cadence: 1 s ring → 1 s silence, looping.
export function useRingTone(active: boolean) {
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }

    let running = true;
    let ctx: AudioContext | null = null;

    const playRing = () => {
      if (!running || !ctx) return;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      // Soft fade-in / fade-out so the ring isn't harsh
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.06);
      gain.gain.setValueAtTime(0.12, now + 0.88);
      gain.gain.linearRampToValueAtTime(0, now + 1.0);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.0);
      osc2.stop(now + 1.0);

      // 1 s ring + 1 s silence = 2 s cadence
      setTimeout(() => {
        if (running) playRing();
      }, 2000);
    };

    try {
      ctx = new AudioContext();
      playRing();
    } catch {
      // AudioContext blocked (e.g. no user gesture yet) — fail silently
    }

    stopRef.current = () => {
      running = false;
      ctx?.close().catch(() => {});
    };

    return () => {
      running = false;
      ctx?.close().catch(() => {});
    };
  }, [active]);
}
