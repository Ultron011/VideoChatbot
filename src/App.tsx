import { useState, useEffect, useRef } from 'react';
import { 
  LiveAvatarSession, 
  SessionEvent, 
  SessionState, 
  AgentEventsEnum 
} from '@heygen/liveavatar-web-sdk';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Settings, 
  MessageSquare, 
  Sparkles, 
  AlertCircle, 
  Info,
  Send,
  HelpCircle,
  Maximize2,
  Minimize2
} from 'lucide-react';

// Preset Avatars
const PRESET_AVATARS = [
  { id: 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a', name: 'Sandbox Test Avatar' },
  { id: '8175dfc2-7858-49d6-b5fa-0c135d1c4bad', name: 'Elenora (Tech Expert)' },
  { id: '7b888024-f8c9-4205-95e1-78ce01497bda', name: 'Shawn (Therapist)' },
  { id: '0930fd59-c8ad-434d-ad53-b391a1768720', name: 'Dexter (Lawyer)' },
  { id: '65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0', name: 'June (HR)' },
  { id: 'custom', name: 'Custom Avatar...' }
];

// Preset Voices
const PRESET_VOICES = [
  { id: '', name: 'Avatar Default Voice' },
  { id: '254ffe1e-c89f-430f-8c36-9e7611d310c0', name: 'Elenora (Professional)' },
  { id: '51afbab6-7af4-473b-95fc-6ce26aac8bb1', name: 'Shawn (IA)' },
  { id: '9c8b542a-bf5c-4f4c-9011-75c79a274387', name: 'Bryan (Professional)' },
  { id: 'c2527536-6d1f-4412-a643-53a3497dada9', name: 'Wayne Liang' },
  { id: 'custom', name: 'Custom Voice...' }
];

interface TranscriptItem {
  id: string;
  sender: 'user' | 'avatar';
  text: string;
}

// Robust content similarity checker to detect echoes/microphone bleed of the avatar's voice.
// Uses a token/word overlap coefficient with length-based guards to prevent false positives.
const isEchoMatch = (transcript: string, lastAvatarSpeech: string): boolean => {
  if (!transcript || !lastAvatarSpeech) return false;
  
  const clean1 = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const clean2 = lastAvatarSpeech.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  
  if (clean1.length === 0 || clean2.length === 0) return false;
  
  const set1 = new Set(clean1);
  const set2 = new Set(clean2);
  
  let intersectionCount = 0;
  let intersectionCharLength = 0;
  for (const word of set1) {
    if (set2.has(word)) {
      intersectionCount++;
      intersectionCharLength += word.length;
    }
  }
  
  const minLength = Math.min(set1.size, set2.size);
  const overlap = intersectionCount / minLength;
  
  // Discard as echo if:
  // - There is high overlap (>= 75%) AND
  // - Either we matched multiple words (>= 2 words with total length >= 6) OR we matched a single very long word (>= 10 characters).
  // This effectively blocks echos/bleed while allowing short user responses like "yes", "no", "thanks", "hello", "hi".
  if (overlap >= 0.75 && ((intersectionCount >= 2 && intersectionCharLength >= 6) || intersectionCharLength >= 10)) {
    return true;
  }
  
  return false;
};


export default function App() {
  // Session Configuration States
  const [selectedAvatar, setSelectedAvatar] = useState(PRESET_AVATARS[0].id);
  const [customAvatarId, setCustomAvatarId] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(PRESET_VOICES[0].id);
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [isSandbox, setIsSandbox] = useState(true);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true); // Hands-free ChatGPT Voice conversation
  const [language, setLanguage] = useState('en');
  const [showVoiceGuide, setShowVoiceGuide] = useState(false);

  // Interactive Session State
  const [session, setSession] = useState<LiveAvatarSession | null>(null);
  const [state, setState] = useState<SessionState>(SessionState.INACTIVE);
  const [error, setError] = useState<string | null>(null);
  
  // Controls & Transcripts
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  // Immersive Mode States
  const [isImmersive, setIsImmersive] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  // References
  const videoRef = useRef<HTMLVideoElement>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameId = useRef<number | null>(null);

  // Refs for tracking states inside callback event closures to avoid stale state bugs
  const stateRef = useRef(state);
  const isVoiceEnabledRef = useRef(isVoiceEnabled);
  const avatarSpeakingRef = useRef(avatarSpeaking);
  const transcriptsRef = useRef<TranscriptItem[]>(transcripts);
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const selectedAvatarRef = useRef(selectedAvatar);
  const lastAvatarSpeakEndedRef = useRef<number>(0);
  const isMutedRef = useRef(isMuted);
  const isAutoMutedRef = useRef(false);
  const recentAvatarSpeechesRef = useRef<string[]>([]);

  const addRecentAvatarSpeech = (text: string) => {
    if (!text) return;
    recentAvatarSpeechesRef.current = [
      text,
      ...recentAvatarSpeechesRef.current.slice(0, 4) // keep last 5 spoken replies in history window
    ];
    console.log("[Echo Shield] Updated recent avatar speech window:", recentAvatarSpeechesRef.current);
  };

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { isVoiceEnabledRef.current = isVoiceEnabled; }, [isVoiceEnabled]);
  useEffect(() => { avatarSpeakingRef.current = avatarSpeaking; }, [avatarSpeaking]);
  useEffect(() => { transcriptsRef.current = transcripts; }, [transcripts]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { selectedAvatarRef.current = selectedAvatar; }, [selectedAvatar]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Audio Visualizer states for rendering bouncing bars
  const [avatarAudioBars, setAvatarAudioBars] = useState<number[]>(new Array(15).fill(4));
  const [userAudioBars, setUserAudioBars] = useState<number[]>(new Array(15).fill(4));

  // Determine active avatar and voice IDs
  const activeAvatarId = selectedAvatar === 'custom' ? customAvatarId : selectedAvatar;
  const activeVoiceId = selectedVoice === 'custom' ? customVoiceId : selectedVoice;

  // Auto-scroll transcripts
  useEffect(() => {
    if (isImmersive && !showSidebar) return; // Prevent horizontal layout shift when sidebar is hidden in full screen
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, interimTranscript, isImmersive, showSidebar]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopLocalCamera();
      stopAudioVisualizer();
      if (session) {
        session.stop().catch(console.error);
      }
    };
  }, [session]);

  // Synchronize sandbox state with allowed avatar selection
  useEffect(() => {
    if (isSandbox) {
      setSelectedAvatar('dd73ea75-1218-4ef3-92ce-606d5f7fbc0a');
    } else {
      // Revert to first premium avatar when turning off sandbox mode
      setSelectedAvatar('8175dfc2-7858-49d6-b5fa-0c135d1c4bad');
    }
  }, [isSandbox]);

  // Toggle body/html classes for scrollbar gutter removal in immersive full screen mode
  useEffect(() => {
    if (isImmersive) {
      document.body.classList.add('immersive-body');
      document.documentElement.classList.add('immersive-body');
    } else {
      document.body.classList.remove('immersive-body');
      document.documentElement.classList.remove('immersive-body');
    }
    return () => {
      document.body.classList.remove('immersive-body');
      document.documentElement.classList.remove('immersive-body');
    };
  }, [isImmersive]);

  // Bind camera stream to video element when camera is toggled or when stream changes
  useEffect(() => {
    if (isCameraOn && localStreamRef.current && userVideoRef.current) {
      console.log("[Camera] Binding local stream to video element.");
      userVideoRef.current.srcObject = localStreamRef.current;
      userVideoRef.current.play().catch(err => {
        console.warn("Error playing user video in useEffect:", err);
      });
    }
  }, [isCameraOn]);

  // Camera handling for user PiP
  const startLocalCamera = async () => {
    try {
      if (localStreamRef.current) {
        stopLocalCamera();
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      localStreamRef.current = stream;
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
        userVideoRef.current.play().catch(err => console.warn("Error playing user video:", err));
      }
      setIsCameraOn(true);
    } catch (e) {
      console.warn("Failed to access camera for user PIP:", e);
      setIsCameraOn(false);
    }
  };

  const stopLocalCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (userVideoRef.current) {
      userVideoRef.current.srcObject = null;
    }
    setIsCameraOn(false);
  };

  const toggleCamera = () => {
    if (isCameraOn) {
      stopLocalCamera();
    } else {
      startLocalCamera();
    }
  };

  // Audio visualizer using Web Audio API for the User's Voice
  const startAudioVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const draw = () => {
        if (!analyserRef.current) return;
        animationFrameId.current = requestAnimationFrame(draw);
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Map frequencies to height values (4px to 32px)
        const heights = Array.from(dataArray).slice(0, 15).map(val => {
          return Math.max(4, Math.floor((val / 255) * 36));
        });
        
        setUserAudioBars(heights);
      };

      draw();
    } catch (err) {
      console.warn("Failed to start audio visualizer for mic:", err);
    }
  };

  const stopAudioVisualizer = () => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setUserAudioBars(new Array(15).fill(4));
  };

  // Bouncing bars effect for avatar voice (sync'd to speech status)
  useEffect(() => {
    let interval: any;
    if (avatarSpeaking) {
      interval = setInterval(() => {
        const heights = Array.from({ length: 15 }, () => Math.floor(Math.random() * 28) + 8);
        setAvatarAudioBars(heights);
      }, 80);
    } else {
      setAvatarAudioBars(new Array(15).fill(4));
    }
    return () => clearInterval(interval);
  }, [avatarSpeaking]);

  const isWaitingForResponseRef = useRef(false);

  const handleVoiceQuery = async (query: string) => {
    const activeSession = sessionRef.current;
    if (!activeSession || isWaitingForResponseRef.current) return;
    isWaitingForResponseRef.current = true;

    // Append the user's spoken transcript
    const userMsgId = Math.random().toString();
    const newUserMsg: TranscriptItem = {
      id: userMsgId,
      sender: 'user',
      text: query
    };
    
    // Update transcripts list state
    setTranscripts(prev => [...prev, newUserMsg]);

    try {
      const backendHost = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
      
      // Build full conversation history for the LLM
      const updatedHistory = [...transcriptsRef.current, newUserMsg];
      const messagesPayload = updatedHistory.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text
      }));

      // Call Express proxy to OpenAI / fallback endpoint
      const chatResponse = await fetch(`${backendHost}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: messagesPayload,
          avatarName: PRESET_AVATARS.find(a => a.id === selectedAvatarRef.current)?.name || 'AI Avatar'
        })
      });

      if (!chatResponse.ok) {
        throw new Error('Failed to fetch reply from LLM backend endpoint');
      }

      const { reply } = await chatResponse.json();

      if (reply) {
        console.log("LLM generated reply (voice):", reply);
        addRecentAvatarSpeech(reply);
        
        // Append the AI reply to transcripts
        setTranscripts(prev => [...prev, {
          id: Math.random().toString(),
          sender: 'avatar',
          text: reply
        }]);

        // Call HeyGen LiveAvatar to speak it
        activeSession.message(reply);
      }
    } catch (err) {
      console.error("Error processing voice conversation via LLM:", err);
      // Speak a friendly warning back through the avatar and add to transcripts
      const errorMsg = "I had trouble reaching my brain. Please check your internet connection.";
      addRecentAvatarSpeech(errorMsg);
      setTranscripts(prev => [...prev, {
        id: Math.random().toString(),
        sender: 'avatar',
        text: errorMsg
      }]);
      activeSession.message(errorMsg);
    } finally {
      isWaitingForResponseRef.current = false;
    }
  };

  // Establish WebRTC Session with HeyGen LiveAvatar
  const handleStartCall = async () => {
    if (!activeAvatarId) {
      setError('Please select or enter an Avatar ID.');
      return;
    }

    setError(null);
    setState(SessionState.CONNECTING);
    setTranscripts([]);

    try {
      const backendHost = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
      console.log('Fetching session token from backend proxy...');
      
      const tokenResponse = await fetch(`${backendHost}/api/session-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          avatar_id: activeAvatarId,
          voice_id: activeVoiceId || undefined,
          is_sandbox: isSandbox,
          language: language
        })
      });

      if (!tokenResponse.ok) {
        const errJson = await tokenResponse.json();
        throw new Error(errJson.error || 'Failed to fetch session token');
      }

      const { token } = await tokenResponse.json();
      console.log('Session token generated successfully. Initializing LiveAvatar session...');

      // Initialize the official HeyGen LiveAvatarSession
      // We set defaultMuted to false so HeyGen captures user speech natively and triggers USER_TRANSCRIPTION.
      const newSession = new LiveAvatarSession(token, {
        voiceChat: {
          defaultMuted: false
        }
      });
      sessionRef.current = newSession;

      // Hook up SDK event listeners
      newSession.on(SessionEvent.SESSION_STATE_CHANGED, (newState) => {
        console.log(`Session state changed: ${newState}`);
        setState(newState);
        if (newState === SessionState.CONNECTED) {
          console.log("Session connected. Activating HeyGen listening mode...");
          try {
            newSession.startListening();
          } catch (err) {
            console.error("Failed to start listening on CONNECTED state change:", err);
          }
        }
      });

      newSession.on(SessionEvent.SESSION_STREAM_READY, () => {
        console.log('WebRTC Media Stream is ready. Attaching stream to video element.');
        if (videoRef.current) {
          newSession.attach(videoRef.current);
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(e => console.error("Video play failed:", e));
          };
        }
      });

      newSession.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
        console.log(`Session disconnected: ${reason}`);
        setState(SessionState.DISCONNECTED);
        handleEndCallCleanup();
      });

      // Transcript and conversational status events
      newSession.on(AgentEventsEnum.USER_SPEAK_STARTED, () => setUserSpeaking(true));
      newSession.on(AgentEventsEnum.USER_SPEAK_ENDED, () => setUserSpeaking(false));
      
      newSession.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        setAvatarSpeaking(true);
        try {
          console.log("Avatar speaking. Pausing listening mode to block echoes...");
          newSession.stopListening();
        } catch (err) {
          console.error("Failed to stop listening on AVATAR_SPEAK_STARTED:", err);
        }

        // Physically mute WebRTC microphone to completely prevent sound leakage
        if (!isMutedRef.current) {
          console.log("[Echo Shield] Automatically muting WebRTC mic during avatar speech...");
          newSession.voiceChat.mute()
            .then(() => {
              isAutoMutedRef.current = true;
            })
            .catch(err => console.error("Auto-mute failed:", err));
        }
      });
      
      newSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        setAvatarSpeaking(false);
        lastAvatarSpeakEndedRef.current = Date.now();
        try {
          console.log("Avatar done speaking. Resuming listening mode...");
          newSession.startListening();
        } catch (err) {
          console.error("Failed to start listening on AVATAR_SPEAK_ENDED:", err);
        }

        // Wait for a 2.0 second cooldown, then unmute the WebRTC mic
        setTimeout(() => {
          const activeSession = sessionRef.current;
          if (activeSession && !avatarSpeakingRef.current && isAutoMutedRef.current) {
            console.log("[Echo Shield] Cooldown ended. Unmuting WebRTC mic for user speech...");
            activeSession.voiceChat.unmute()
              .then(() => {
                isAutoMutedRef.current = false;
              })
              .catch(err => console.error("Auto-unmute failed:", err));
          }
        }, 2000);
      });

      // Listen to native avatar transcription events as well, to capture any default greetings or SDK spoken text
      newSession.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (event) => {
        const text = event.text?.trim();
        if (text) {
          console.log(`[Echo Shield] SDK Avatar Transcription Event: "${text}"`);
          addRecentAvatarSpeech(text);
        }
      });

      newSession.on(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, (event) => {
        const text = event.text;
        if (text) {
          // Content similarity match against recent avatar speeches to shield from echos
          const isSpeechSimilarityMatch = recentAvatarSpeechesRef.current.some(speech => 
            isEchoMatch(text, speech)
          );

          if (isSpeechSimilarityMatch) {
            // Ignore interim text during bleed match
            return;
          }

          console.log(`HeyGen STT Chunk: "${text}"`);
          setInterimTranscript(text);
        }
      });

      newSession.on(AgentEventsEnum.USER_TRANSCRIPTION, (event) => {
        const text = event.text?.trim();
        if (text) {
          // Content similarity match against recent avatar speeches to shield from echos
          const isSpeechSimilarityMatch = recentAvatarSpeechesRef.current.some(speech => 
            isEchoMatch(text, speech)
          );

          if (isSpeechSimilarityMatch) {
            console.log(`[Echo Shield] Discarded echo transcript "${text}" (Similarity Match)`);
            setInterimTranscript(''); // Clear the real-time buffer
            return;
          }

          console.log(`HeyGen STT Final: "${text}"`);
          setInterimTranscript(''); // Clear the real-time buffer
          if (isVoiceEnabledRef.current) {
            console.log(`HeyGen STT Final (ChatGPT Mode): "${text}"`);
            handleVoiceQuery(text);
          } else {
            // Keyboard mode: just log transcript on screen without triggering ChatGPT automatically
            setTranscripts(prev => [...prev, {
              id: event.event_id || Math.random().toString(),
              sender: 'user',
              text: text
            }]);
          }
        }
      });

      // Start the session
      await newSession.start();
      setSession(newSession);

      try {
        console.log("Session started. Calling startListening initially...");
        newSession.startListening();
      } catch (err) {
        console.error("Failed to start listening on session startup:", err);
      }

      // Start local visual visualizers
      startAudioVisualizer();
      if (isCameraOn) {
        startLocalCamera();
      }

    } catch (e: any) {
      console.error('Call initialization failed:', e);
      setError(e.message || 'Call failed to establish. Please check your API Key and credits.');
      setState(SessionState.INACTIVE);
    }
  };

  // Clean up and disconnect
  const handleEndCall = async () => {
    const activeSession = sessionRef.current;
    if (activeSession) {
      try {
        await activeSession.stop();
      } catch (e) {
        console.error("Error stopping session:", e);
      }
    }
    handleEndCallCleanup();
  };

  const handleEndCallCleanup = () => {
    isAutoMutedRef.current = false;
    sessionRef.current = null;
    setSession(null);
    setState(SessionState.INACTIVE);
    setAvatarSpeaking(false);
    setUserSpeaking(false);
    setIsImmersive(false);
    setShowSidebar(true);
    stopAudioVisualizer();
  };

  // Mute / Unmute local microphone
  const toggleMute = async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    try {
      if (isMuted) {
        await activeSession.voiceChat.unmute();
        setIsMuted(false);
        isAutoMutedRef.current = false;
      } else {
        await activeSession.voiceChat.mute();
        setIsMuted(true);
        isAutoMutedRef.current = false;
      }
    } catch (e) {
      console.error("Mute toggle failed:", e);
    }
  };

  // Text message speaking fallback (modified to support ChatGPT)
  const handleSendMessage = async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || !textInput.trim()) return;
    const query = textInput;
    setTextInput('');

    // Append the user's typed transcript
    const userMsgId = Math.random().toString();
    const newUserMsg: TranscriptItem = {
      id: userMsgId,
      sender: 'user',
      text: query
    };
    
    setTranscripts(prev => [...prev, newUserMsg]);

    try {
      const backendHost = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
      
      const updatedHistory = [...transcriptsRef.current, newUserMsg];
      const messagesPayload = updatedHistory.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text
      }));

      const chatResponse = await fetch(`${backendHost}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: messagesPayload,
          avatarName: PRESET_AVATARS.find(a => a.id === selectedAvatarRef.current)?.name || 'AI Avatar'
        })
      });

      if (!chatResponse.ok) {
        throw new Error('Failed to fetch reply from LLM backend endpoint');
      }

      const { reply } = await chatResponse.json();

      if (reply) {
        console.log("LLM generated reply (typed):", reply);
        addRecentAvatarSpeech(reply);
        
        // Append the AI reply to transcripts
        setTranscripts(prev => [...prev, {
          id: Math.random().toString(),
          sender: 'avatar',
          text: reply
        }]);

        activeSession.message(reply);
      }
    } catch (err) {
      console.error("Error processing typed conversation via LLM:", err);
      // Speak a friendly warning back through the avatar and add to transcripts
      const errorMsg = "I had trouble reaching my brain. Please check your internet connection.";
      addRecentAvatarSpeech(errorMsg);
      setTranscripts(prev => [...prev, {
        id: Math.random().toString(),
        sender: 'avatar',
        text: errorMsg
      }]);
      activeSession.message(errorMsg);
    }
  };

  return (
    <div className={isImmersive ? "immersive-active" : ""}>
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-pulse"></div>
          <h1 className="app-title">LiveCall AI</h1>
          <span className="app-subtitle">LIVE WEBRTC INTERACTIVE AVATAR</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {state !== SessionState.INACTIVE && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div className={`status-dot ${state === SessionState.CONNECTED ? 'active' : 'connecting'}`}></div>
              <span className="status-text">{state}</span>
            </div>
          )}
        </div>
      </header>

      <main className="app-container">
        {error && (
          <div className="api-warning-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={18} />
              <strong>Connection Error</strong>
            </div>
            <p>{error}</p>
            <span style={{ fontSize: '0.75rem', marginTop: '0.25rem', opacity: 0.8 }}>
              Check your Node server console and verify your <code>HEYGEN_API_KEY</code> is correctly set in <code>.env</code>.
            </span>
          </div>
        )}

        <div className="dashboard-grid">
          {/* Settings Sidebar */}
          <section className="settings-panel">
            <h2 className="panel-title"><Settings size={18} /> Call Setup</h2>
            
            <div className="settings-section">
              <label className="settings-label">Select Avatar</label>
              <div className="select-wrapper">
                <select 
                  className="custom-select"
                  value={selectedAvatar}
                  onChange={(e) => setSelectedAvatar(e.target.value)}
                  disabled={state !== SessionState.INACTIVE || isSandbox}
                >
                  {isSandbox ? (
                    <option value="dd73ea75-1218-4ef3-92ce-606d5f7fbc0a">
                      Sandbox Test Avatar (Locked)
                    </option>
                  ) : (
                    PRESET_AVATARS.filter(a => a.id !== 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a').map(avatar => (
                      <option key={avatar.id} value={avatar.id}>{avatar.name}</option>
                    ))
                  )}
                </select>
              </div>

              {isSandbox && (
                <span style={{ fontSize: '0.72rem', color: 'var(--accent-teal)', marginTop: '0.35rem', display: 'block', opacity: 0.9 }}>
                  ℹ️ Sandbox mode is locked to the official test avatar.
                </span>
              )}

              {selectedAvatar === 'custom' && !isSandbox && (
                <input 
                  type="text" 
                  className="custom-select" 
                  placeholder="Paste HeyGen Avatar UUID"
                  value={customAvatarId}
                  onChange={(e) => setCustomAvatarId(e.target.value)}
                  style={{ marginTop: '0.5rem' }}
                  disabled={state !== SessionState.INACTIVE}
                />
              )}
            </div>

            <div className="settings-section">
              <label className="settings-label">Voice Override</label>
              <div className="select-wrapper">
                <select 
                  className="custom-select"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  disabled={state !== SessionState.INACTIVE}
                >
                  {PRESET_VOICES.map(voice => (
                    <option key={voice.id} value={voice.id}>{voice.name}</option>
                  ))}
                </select>
              </div>

              {selectedVoice === 'custom' && (
                <>
                  <input 
                    type="text" 
                    className="custom-select" 
                    placeholder="Paste HeyGen Voice ID or ElevenLabs UUID"
                    value={customVoiceId}
                    onChange={(e) => setCustomVoiceId(e.target.value)}
                    style={{ marginTop: '0.5rem' }}
                    disabled={state !== SessionState.INACTIVE}
                  />
                  <div className="custom-voice-tip" style={{
                    marginTop: '0.5rem',
                    padding: '0.75rem',
                    background: 'rgba(124, 58, 237, 0.08)',
                    border: '1px solid rgba(124, 58, 237, 0.2)',
                    borderRadius: '8px',
                    fontSize: '0.72rem',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.4'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--accent-purple)', fontWeight: '600', marginBottom: '0.25rem' }}>
                      <Sparkles size={12} />
                      <span>Custom Voice (Path A) Active</span>
                    </div>
                    <p style={{ margin: 0, opacity: 0.85 }}>
                      HeyGen dynamically synthesizes your response text using your cloned voice. Lip-sync is automatically matched!
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="settings-section">
              <label className="settings-label">Language</label>
              <div className="select-wrapper">
                <select 
                  className="custom-select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={state !== SessionState.INACTIVE}
                >
                  <option value="en">English (US)</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="ja">Japanese</option>
                  <option value="hi">Hindi</option>
                </select>
              </div>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-title">Sandbox Mode</span>
                <span className="toggle-desc">
                  {isSandbox ? "Free 1-min test call" : "Full production call"}
                </span>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={isSandbox}
                  onChange={(e) => setIsSandbox(e.target.checked)}
                  disabled={state !== SessionState.INACTIVE}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-title">ChatGPT Voice Mode</span>
                <span className="toggle-desc">
                  {isVoiceEnabled ? "Hands-free voice chat" : "Keyboard chat mode"}
                </span>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={isVoiceEnabled}
                  onChange={(e) => setIsVoiceEnabled(e.target.checked)}
                  disabled={state !== SessionState.INACTIVE}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <button 
                onClick={() => setShowVoiceGuide(!showVoiceGuide)}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '0.5rem 0.75rem',
                  color: 'var(--text-secondary)',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                  marginBottom: '0.75rem'
                }}
                className="guide-toggle-btn"
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '500' }}>
                  <HelpCircle size={14} style={{ color: 'var(--accent-teal)' }} />
                  Custom Cloned Voice Guide
                </span>
                <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>
                  {showVoiceGuide ? 'Hide' : 'Show'}
                </span>
              </button>

              {showVoiceGuide && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '0.85rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '0.72rem',
                  color: 'var(--text-muted)',
                  lineHeight: '1.45'
                }}>
                  <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    Path A Setup Instructions:
                  </strong>
                  <p style={{ margin: '0 0 0.5rem 0' }}>
                    This application uses **Path A (HeyGen Dynamic TTS Integration)**. The avatar's voice and lips are generated by HeyGen.
                  </p>
                  <strong style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.7rem', marginTop: '0.5rem' }}>
                    1. Direct HeyGen Clone (Real-Time Engine Required)
                  </strong>
                  <ul style={{ margin: '0.15rem 0 0.5rem 1rem', padding: 0 }}>
                    <li>Go to HeyGen Dashboard → <strong>Interactive Avatars / Streaming</strong> section.</li>
                    <li>Your cloned voice must support their ultra-low-latency <strong>real-time streaming engine (e.g., Starfish)</strong>. Standard batch video-creator voices will time out and fail.</li>
                    <li>Once ready, copy its <strong>Voice ID</strong> and paste it above.</li>
                  </ul>
                  <strong style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.7rem' }}>
                    2. ElevenLabs Integration (Low-Latency Turbo Models)
                  </strong>
                  <ul style={{ margin: '0.15rem 0 0 1rem', padding: 0 }}>
                    <li>Link your ElevenLabs account inside your HeyGen developer settings.</li>
                    <li>Use a fast-streaming ElevenLabs voice (such as those using the <strong>Turbo/Flash</strong> model configurations) to avoid WebRTC handshaking errors.</li>
                  </ul>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: '1.4' }}>
                <Info size={16} style={{ flexShrink: 0, color: 'var(--accent-teal)' }} />
                <span>
                  <strong>Full Mode Call:</strong> The avatar listens and speaks completely automatically via voice WebRTC. Sandbox mode allows 1-minute free testing.
                </span>
              </div>
            </div>
          </section>

          {/* Main Video Stage Area */}
          <section className="call-container">
            <div className="video-stage">
              {/* Main Avatar Video Frame */}
              <video 
                ref={videoRef}
                className="avatar-video"
                playsInline
                autoPlay
              />

              {/* Local User Picture-In-Picture */}
              <div className={`user-pip ${isImmersive && showSidebar ? 'shifted' : ''}`} onClick={toggleCamera}>
                <video 
                  ref={userVideoRef}
                  className="user-video"
                  playsInline
                  autoPlay
                  muted
                  style={{ display: isCameraOn ? 'block' : 'none' }}
                />
                {!isCameraOn && (
                  <div className="user-pip-fallback">
                    <VideoOff size={18} />
                    <span>Camera Off</span>
                  </div>
                )}
              </div>

              {/* Calling Overlay / Loading Panel */}
              {state === SessionState.CONNECTING && (
                <div className="screen-overlay">
                  <div className="overlay-icon-container">
                    <div className="overlay-pulse-ring"></div>
                    <div className="overlay-pulse-ring-slow"></div>
                    <div className="overlay-icon-circle">
                      <Sparkles size={32} />
                    </div>
                  </div>
                  <h3 className="overlay-title">Dialing AI Avatar</h3>
                  <p className="overlay-desc">
                    Establishing a secure WebRTC media stream channel and initializing LiveKit room. Please hold...
                  </p>
                </div>
              )}

              {state === SessionState.INACTIVE && (
                <div className="screen-overlay">
                  <div className="overlay-icon-container">
                    <div className="overlay-icon-circle" style={{ background: 'var(--bg-tertiary)' }}>
                      <Phone size={32} style={{ color: 'var(--text-secondary)' }} />
                    </div>
                  </div>
                  <h3 className="overlay-title">Ready for Conversation</h3>
                  <p className="overlay-desc">
                    Select your avatar styles and click start call below to launch an interactive live voice session.
                  </p>
                  <button 
                    onClick={handleStartCall}
                    className="control-btn start-call"
                  >
                    <Phone size={18} /> Start Call Session
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Call Controls */}
            {state !== SessionState.INACTIVE && (
              <div className="call-controls-bar">
                <button 
                  onClick={toggleMute}
                  className={`control-btn ${isMuted ? 'muted' : ''}`}
                  data-tooltip={isMuted ? "Unmute Mic" : "Mute Mic"}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                <button 
                  onClick={toggleCamera}
                  className={`control-btn ${isCameraOn ? 'active' : ''}`}
                  data-tooltip={isCameraOn ? "Turn Camera Off" : "Turn Camera On"}
                >
                  {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>

                {isImmersive && (
                  <button 
                    onClick={() => setShowSidebar(!showSidebar)}
                    className={`control-btn ${showSidebar ? 'active' : ''}`}
                    data-tooltip={showSidebar ? "Hide Chat Sidebar" : "Show Chat Sidebar"}
                  >
                    <MessageSquare size={18} />
                  </button>
                )}

                <button 
                  onClick={() => setIsImmersive(!isImmersive)}
                  className={`control-btn ${isImmersive ? 'active' : ''}`}
                  data-tooltip={isImmersive ? "Exit Full Screen" : "Enter Full Screen"}
                >
                  {isImmersive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>

                <button 
                  onClick={handleEndCall}
                  className="control-btn end-call"
                  data-tooltip="End Connection"
                >
                  <PhoneOff size={18} /> Hang Up
                </button>
              </div>
            )}

            {/* Split bottom pane: Visualizers & Live Transcripts */}
            <div className={`call-details-pane ${isImmersive && !showSidebar ? 'hidden' : ''}`}>
              {/* Speech transcripts */}
              <div className="transcript-box">
                <div className="transcript-header">
                  <h4 className="transcript-title"><MessageSquare size={16} /> Live Transcript</h4>
                  {state === SessionState.CONNECTED && <span className="badge-live">Live</span>}
                </div>
                <div className="transcript-list">
                  {transcripts.length === 0 && !interimTranscript ? (
                    <div className="transcript-placeholder">
                      <HelpCircle size={24} style={{ color: 'var(--text-muted)' }} />
                      <span>Speak to the avatar or type a message. Transcription will load here.</span>
                    </div>
                  ) : (
                    <>
                      {transcripts.map((t) => (
                        <div 
                          key={t.id} 
                          className={`transcript-item ${t.sender === 'user' ? 'user-bubble' : 'avatar-bubble'}`}
                        >
                          <span className={`transcript-sender ${t.sender}`}>
                            {t.sender === 'user' ? 'You' : 'Avatar'}
                          </span>
                          <p className="transcript-text">{t.text}</p>
                        </div>
                      ))}
                      {interimTranscript && (
                        <div 
                          className="transcript-item user-bubble" 
                          style={{ opacity: 0.65, border: '1px dashed rgba(255, 255, 255, 0.2)', background: 'rgba(255, 255, 255, 0.02)' }}
                        >
                          <span className="transcript-sender user">You (Speaking...)</span>
                          <p className="transcript-text" style={{ fontStyle: 'italic' }}>{interimTranscript}</p>
                        </div>
                      )}
                    </>
                  )}
                  <div ref={transcriptEndRef} />
                </div>

                {state === SessionState.CONNECTED && !isVoiceEnabled && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input 
                      type="text" 
                      className="custom-select" 
                      placeholder="Type a response to the avatar..."
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      style={{ flex: 1 }}
                    />
                    <button 
                      onClick={handleSendMessage}
                      className="control-btn active"
                      style={{ width: '42px', height: '42px', borderRadius: '12px' }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                )}
              </div>

              {/* Waves/Visualizers */}
              <div className="waveform-box">
                <div className="visualizer-card">
                  <div className="visualizer-label">
                    <span>AVATAR AUDIO ENERGY</span>
                    <span style={{ color: 'var(--accent-purple)' }}>
                      {avatarSpeaking ? 'SPEAKING' : 'IDLE'}
                    </span>
                  </div>
                  <div className="visualizer-bars-container">
                    {avatarAudioBars.map((h, i) => (
                      <div 
                        key={i} 
                        className={`visualizer-bar ${avatarSpeaking ? 'active-avatar' : ''}`}
                        style={{ height: `${h}px` }}
                      />
                    ))}
                  </div>
                </div>

                <div className="visualizer-card">
                  <div className="visualizer-label">
                    <span>YOUR VOICE INPUT</span>
                    <span style={{ 
                      color: isMuted ? 'var(--text-muted)' : 
                             !isVoiceEnabled ? '#eab308' : 
                             avatarSpeaking ? 'var(--accent-purple)' : 
                             userSpeaking ? 'var(--accent-teal)' : '#22c55e'
                    }}>
                      {isMuted ? 'MUTED' : 
                       !isVoiceEnabled ? 'KEYBOARD ONLY' : 
                       avatarSpeaking ? 'ECHO SHIELD' : 
                       userSpeaking ? 'TALKING' : 'LISTENING'}
                    </span>
                  </div>
                  <div className="visualizer-bars-container">
                    {userAudioBars.map((h, i) => (
                      <div 
                        key={i} 
                        className={`visualizer-bar ${userSpeaking ? 'active-user' : ''}`}
                        style={{ height: `${h}px` }}
                      />
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
