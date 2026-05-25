import { useEffect, useRef, useState } from 'react';

export function useLocalCamera() {
  const [isCameraOn, setIsCameraOn] = useState(false);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
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

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (userVideoRef.current) userVideoRef.current.srcObject = null;
    setIsCameraOn(false);
  };

  const toggle = () => (isCameraOn ? stop() : start());

  // Re-bind the stream after a parent screen swap so the active <video> element picks it up.
  const rebind = () => {
    if (isCameraOn && streamRef.current && userVideoRef.current) {
      userVideoRef.current.srcObject = streamRef.current;
      userVideoRef.current.play().catch(() => {});
    }
  };

  useEffect(() => () => stop(), []);

  return { isCameraOn, toggle, stop, userVideoRef, rebind };
}
