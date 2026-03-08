import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, AlertTriangle, ArrowRight, MessageSquareText, Radio, Camera, Send, Mail, CheckCircle, Image, WifiOff, X, Sun, Moon, Scale, Zap, RotateCcw, ChevronDown, ChevronUp, Clock, Video } from 'lucide-react';
import useWebSocket from 'react-use-websocket';
import { useGoogleLogin } from '@react-oauth/google';
import './index.css';

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [agentSpeaking, setAgentSpeaking] = useState(false);
    const [transcripts, setTranscripts] = useState(() => {
        try { return JSON.parse(localStorage.getItem('fraud-check-transcripts')) || []; } catch { return []; }
    });
    const [violations, setViolations] = useState(() => {
        try { return JSON.parse(localStorage.getItem('fraud-check-violations')) || []; } catch { return []; }
    });
    const [activeTab, setActiveTab] = useState('live');
    const [googleToken, setGoogleToken] = useState(null);
    const [sendingEmailId, setSendingEmailId] = useState(null);
    const [sentEmails, setSentEmails] = useState(new Set());
    const [lastEvidence, setLastEvidence] = useState(() => {
        try { return JSON.parse(localStorage.getItem('fraud-check-evidence')); } catch { return null; }
    });
    const [toast, setToast] = useState(null);
    const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('fraud-check-onboarded'));
    const [expandedViolations, setExpandedViolations] = useState(new Set());
    const [subtitleVisible, setSubtitleVisible] = useState(false);
    const [hasStartedConversation, setHasStartedConversation] = useState(false);
    const [isLiveSession, setIsLiveSession] = useState(false);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const toastTimeoutRef = useRef(null);
    const wasConnectedRef = useRef(false);

    // Theme state
    const [theme, setTheme] = useState(() => {
        const saved = localStorage.getItem('fraud-check-theme');
        if (saved) return saved;
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    });

    // Desktop detection
    const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);

    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const handler = (e) => setIsDesktop(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // Apply theme
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('fraud-check-theme', theme);
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute('content', theme === 'light' ? '#f5f5f7' : '#0a0a0a');
        }
    }, [theme]);

    const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

    const playbackCtxRef = useRef(null);
    const micCleanupRef = useRef(null);
    const playbackTimeRef = useRef(0);
    const speakingTimeoutRef = useRef(null);
    const transcriptEndRef = useRef(null);
    const imgInputRef = useRef(null);
    const cameraInputRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const cameraStreamRef = useRef(null);

    const agentSpeakingRef = useRef(false);
    const prevAgentSpeakingRef = useRef(false);
    useEffect(() => { agentSpeakingRef.current = agentSpeaking; }, [agentSpeaking]);

    const showToast = useCallback((message, type = 'error', duration = 5000) => {
        clearTimeout(toastTimeoutRef.current);
        setToast({ message, type });
        toastTimeoutRef.current = setTimeout(() => setToast(null), duration);
    }, []);

    const backendPort = import.meta.env.VITE_BACKEND_PORT || '8002';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = import.meta.env.DEV
        ? `ws://localhost:${backendPort}`
        : `${wsProtocol}//${window.location.host}`;
    const apiBase = import.meta.env.DEV ? `http://localhost:${backendPort}` : '';

    const { sendMessage, lastMessage, readyState } = useWebSocket(wsUrl, {
        shouldReconnect: () => true,
        reconnectAttempts: Infinity,
        reconnectInterval: (attemptNumber) => Math.min(1000 * Math.pow(2, attemptNumber), 10000),
        onClose: () => {
            if (wasConnectedRef.current) {
                showToast('Connection lost. Reconnecting...', 'error');
                if (cameraStreamRef.current) {
                    cameraStreamRef.current.getTracks().forEach(t => t.stop());
                    cameraStreamRef.current = null;
                    if (videoRef.current) videoRef.current.srcObject = null;
                    setIsLiveSession(false);
                    setIsCameraReady(false);
                }
                if (micCleanupRef.current) {
                    micCleanupRef.current();
                    micCleanupRef.current = null;
                    setIsRecording(false);
                }
            }
        },
        onReconnectStop: () => {
            showToast('Could not reconnect. Please refresh the page.', 'error', 15000);
        },
    });

    useEffect(() => {
        const connected = readyState === 1;
        setIsConnected(connected);
        if (connected && wasConnectedRef.current) {
            showToast('Reconnected!', 'success', 3000);
        }
        wasConnectedRef.current = connected;
    }, [readyState, showToast]);

    // Auto-switch to camera tab on mobile when live session starts
    useEffect(() => {
        if (isLiveSession && !isDesktop) {
            setActiveTab('camera');
        } else if (!isLiveSession && activeTab === 'camera') {
            setActiveTab('live');
        }
    }, [isLiveSession, isDesktop]);

    // Auto-scroll transcripts
    useEffect(() => {
        if (isDesktop || activeTab === 'transcript') {
            transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcripts, activeTab, isDesktop]);

    // Cleanup camera on unmount
    useEffect(() => {
        return () => {
            if (cameraStreamRef.current) {
                cameraStreamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

    // Session persistence
    useEffect(() => {
        localStorage.setItem('fraud-check-transcripts', JSON.stringify(transcripts));
    }, [transcripts]);
    useEffect(() => {
        localStorage.setItem('fraud-check-violations', JSON.stringify(violations));
    }, [violations]);
    useEffect(() => {
        if (lastEvidence) localStorage.setItem('fraud-check-evidence', JSON.stringify(lastEvidence));
    }, [lastEvidence]);

    const handleNewSession = () => {
        setTranscripts([]);
        setViolations([]);
        setLastEvidence(null);
        setSentEmails(new Set());
        setExpandedViolations(new Set());
        localStorage.removeItem('fraud-check-transcripts');
        localStorage.removeItem('fraud-check-violations');
        localStorage.removeItem('fraud-check-evidence');
        if (isLiveSession) stopLiveSession();
        else if (isRecording) stopRecording();
    };

    const dismissOnboarding = () => {
        localStorage.setItem('fraud-check-onboarded', '1');
        setShowOnboarding(false);
    };

    const scenarios = [
        { text: 'Overcharged for a product', icon: '\u{1F4B0}', sub: 'Charged above MRP or quoted price' },
        { text: 'Defective item received', icon: '\u{1F4E6}', sub: 'Broken, damaged, or not as described' },
        { text: 'Online order not delivered', icon: '\u{1F69A}', sub: 'Paid but never received the item' },
        { text: 'Fake or misleading ad', icon: '\u{1F4E2}', sub: 'False claims or deceptive marketing' },
    ];

    const toggleViolationExpand = (id) => {
        setExpandedViolations(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleScenario = (text) => {
        setHasStartedConversation(true);
        sendMessage(JSON.stringify({
            text: `The user has selected a complaint scenario: "${text}". First greet them briefly, then respond directly by asking for specific details about this situation (what happened, where, when, how much, etc.) so you can identify the relevant consumer protection law.`
        }));
        setTranscripts(prev => [...prev, { role: 'user', text, id: Date.now() }]);
    };

    // --- Playback ---
    const playAudio = useCallback(async (base64Audio) => {
        if (!playbackCtxRef.current) {
            const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
            playbackCtxRef.current = ctx;
        }
        const ctx = playbackCtxRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        const binaryStr = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const pcmData = new Int16Array(bytes.buffer);
        const floatData = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) floatData[i] = pcmData[i] / 0x7FFF;

        const buffer = ctx.createBuffer(1, floatData.length, 24000);
        buffer.getChannelData(0).set(floatData);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        const startAt = Math.max(now, playbackTimeRef.current);
        source.start(startAt);
        playbackTimeRef.current = startAt + buffer.duration;

        setAgentSpeaking(true);
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = setTimeout(() => {
            setAgentSpeaking(false);
        }, (startAt + buffer.duration - now) * 1000 + 300);
    }, []);

    // --- Handle messages ---
    useEffect(() => {
        if (lastMessage === null) return;
        try {
            const msg = JSON.parse(lastMessage.data);
            if (msg.type === 'audio') {
                playAudio(msg.data);
            } else if (msg.type === 'transcript') {
                setTranscripts(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === msg.role) {
                        const updated = [...prev];
                        updated[updated.length - 1] = { ...last, text: last.text + msg.text };
                        return updated;
                    }
                    return [...prev, { role: msg.role, text: msg.text, id: Date.now() }];
                });
            } else if (msg.type === 'violation') {
                const newViolation = { ...msg.data, id: Date.now() };
                setViolations(prev => [...prev, newViolation]);
                setTranscripts(prev => {
                    const updated = [...prev];
                    for (let i = updated.length - 1; i >= 0; i--) {
                        if (updated[i].role === 'agent') {
                            updated[i] = {
                                ...updated[i],
                                violations: [...(updated[i].violations || []), newViolation]
                            };
                            break;
                        }
                    }
                    return updated;
                });
            } else if (msg.type === 'email_draft') {
                const newDraft = { ...msg.data, id: Date.now() };
                setTranscripts(prev => {
                    const updated = [...prev];
                    for (let i = updated.length - 1; i >= 0; i--) {
                        if (updated[i].role === 'agent') {
                            updated[i] = {
                                ...updated[i],
                                draft: newDraft
                            };
                            break;
                        }
                    }
                    return updated;
                });
            } else if (msg.type === 'interrupt') {
                if (playbackCtxRef.current) {
                    playbackCtxRef.current.close();
                    playbackCtxRef.current = null;
                }
                playbackTimeRef.current = 0;
                setAgentSpeaking(false);
                clearTimeout(speakingTimeoutRef.current);
            } else if (msg.type === 'error') {
                console.error('Backend error:', msg.message);
                showToast(msg.message || 'Something went wrong', 'error');
            }
        } catch (err) {
            console.error('Parse error', err);
        }
    }, [lastMessage, playAudio]);

    // --- Mic recording ---
    const startRecording = async () => {
        try {
            if (!playbackCtxRef.current) {
                const pCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
                playbackCtxRef.current = pCtx;
            }
            if (playbackCtxRef.current.state === 'suspended') {
                await playbackCtxRef.current.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });

            const micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            await micCtx.audioWorklet.addModule('/mic-processor.js');

            const micSource = micCtx.createMediaStreamSource(stream);
            const workletNode = new AudioWorkletNode(micCtx, 'mic-processor');
            micSource.connect(workletNode);
            workletNode.connect(micCtx.destination);

            let chunkCount = 0;

            workletNode.port.onmessage = (e) => {
                if (readyState !== 1) return;
                const { buffer } = e.data;
                const uint8 = new Uint8Array(buffer);
                chunkCount++;

                let binary = '';
                for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
                sendMessage(JSON.stringify({ audio: btoa(binary) }));
            };

            micCleanupRef.current = () => {
                workletNode.disconnect();
                micSource.disconnect();
                stream.getTracks().forEach(t => t.stop());
                micCtx.close();
            };
            setIsRecording(true);
        } catch (err) {
            console.error('Mic error', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showToast('Microphone access denied. Please allow mic permissions.', 'error', 8000);
            } else if (err.name === 'NotFoundError') {
                showToast('No microphone found. Please connect a mic.', 'error', 8000);
            } else {
                showToast('Could not start microphone. Please try again.', 'error');
            }
        }
    };

    const stopRecording = () => {
        if (micCleanupRef.current) {
            micCleanupRef.current();
            micCleanupRef.current = null;
        }
        setIsRecording(false);
    };

    // --- Live Session (Camera + Mic) ---
    const startLiveSession = async () => {
        try {
            if (!playbackCtxRef.current) {
                const pCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
                playbackCtxRef.current = pCtx;
            }
            if (playbackCtxRef.current.state === 'suspended') {
                await playbackCtxRef.current.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            }
            cameraStreamRef.current = stream;
            setIsCameraReady(true);

            const micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            await micCtx.audioWorklet.addModule('/mic-processor.js');
            const micSource = micCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
            const workletNode = new AudioWorkletNode(micCtx, 'mic-processor');
            micSource.connect(workletNode);
            workletNode.connect(micCtx.destination);

            workletNode.port.onmessage = (e) => {
                if (readyState !== 1) return;
                const { buffer } = e.data;
                const uint8 = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
                sendMessage(JSON.stringify({ audio: btoa(binary) }));
            };

            micCleanupRef.current = () => {
                workletNode.disconnect();
                micSource.disconnect();
                stream.getTracks().forEach(t => t.stop());
                micCtx.close();
            };

            setIsRecording(true);
            setIsLiveSession(true);
            if (!hasStartedConversation) {
                setHasStartedConversation(true);
                sendMessage(JSON.stringify({
                    text: 'The user just started a live session with their camera. Greet them warmly and let them know they can show you anything — receipts, products, packaging — and you\'ll help analyze it for their complaint. Keep it short, 1-2 sentences.'
                }));
            }
        } catch (err) {
            console.error('Live session error', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showToast('Camera/mic access denied. Please allow permissions.', 'error', 8000);
            } else if (err.name === 'NotFoundError') {
                showToast('No camera found. Please connect a camera.', 'error', 8000);
            } else {
                showToast('Could not start live session. Please try again.', 'error');
            }
        }
    };

    const stopLiveSession = () => {
        if (micCleanupRef.current) {
            micCleanupRef.current();
            micCleanupRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        cameraStreamRef.current = null;
        setIsRecording(false);
        setIsLiveSession(false);
        setIsCameraReady(false);
    };

    const toggleLiveSession = () => {
        if (isLiveSession) {
            stopLiveSession();
        } else {
            startLiveSession();
        }
    };

    const captureFrame = (e) => {
        if (!videoRef.current || !isCameraReady) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const ripple = document.createElement('div');
        ripple.className = 'camera-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        e.currentTarget.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);

        const video = videoRef.current;
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

        sendMessage(JSON.stringify({ image: base64, mimeType: 'image/jpeg' }));
        sendMessage(JSON.stringify({
            text: 'I just captured a frame from my live camera. Please describe only what you can actually see in this image. Does it support my complaint? If the image is unclear, say so.'
        }));

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        setLastEvidence({ name: `capture-${timestamp}.jpg`, type: 'image/jpeg', base64 });

        setTranscripts(prev => [...prev, {
            role: 'user',
            text: '\u{1F4F8} Live Capture',
            id: Date.now(),
            evidencePreview: `data:image/jpeg;base64,${base64}`
        }]);

        showToast('Frame captured & sent for analysis', 'success', 2000);
    };

    // Auto-start listening after agent finishes speaking
    useEffect(() => {
        if (prevAgentSpeakingRef.current && !agentSpeaking && !isRecording && !isLiveSession) {
            startRecording();
        }
        prevAgentSpeakingRef.current = agentSpeaking;
    }, [agentSpeaking]);

    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result.split(',')[1];
                setLastEvidence({ name: file.name, type: file.type, base64: base64String });
                sendMessage(JSON.stringify({
                    image: base64String,
                    mimeType: file.type
                }));
                // Auto-prompt Gemini to analyze the uploaded evidence
                sendMessage(JSON.stringify({
                    text: 'I just uploaded a photo as evidence. Please describe only what you can actually see in this image. Does it support my complaint? If the image is unclear, say so.'
                }));
                setTranscripts(prev => [...prev, { role: 'user', text: `\u{1F4F8} Uploaded Evidence: ${file.name}`, id: Date.now() }]);
            };
            reader.readAsDataURL(file);
        }
    };

    const login = useGoogleLogin({
        onSuccess: (codeResponse) => setGoogleToken(codeResponse.access_token),
        scope: 'https://www.googleapis.com/auth/gmail.send',
    });

    const triggerSendEmail = async (draft, id) => {
        if (!googleToken) {
            login();
            return;
        }

        setSendingEmailId(id);
        try {
            const res = await fetch(`${apiBase}/api/send-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${googleToken}`
                },
                body: JSON.stringify({
                    to: draft.to,
                    subject: draft.subject,
                    message: draft.raw,
                    attachment: lastEvidence
                })
            });
            const data = await res.json();
            if (data.success) {
                setSentEmails(prev => new Set(prev).add(id));
                showToast('Email sent successfully!', 'success', 4000);
            } else {
                showToast('Failed to send: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            showToast('Network error sending email. Please try again.', 'error');
        }
        setSendingEmailId(null);
    };

    const toggleRecording = () => {
        if (isLiveSession) return; // Controlled by live session toggle instead
        if (!hasStartedConversation) {
            setHasStartedConversation(true);
            // Send hidden trigger to AI to greet the user
            sendMessage(JSON.stringify({
                text: 'The user just tapped the orb to start the conversation. Please greet them warmly in a friendly, Gen Z style. Keep it short - just 1-2 sentences. Do not mention that they tapped an orb.'
            }));
            startRecording();
            return;
        }

        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const orbState = agentSpeaking ? 'speaking' : isRecording ? 'listening' : 'idle';
    const statusText = agentSpeaking ? 'Speaking...' : isRecording ? 'Listening...' : isConnected ? 'Share your experience' : 'Connecting...';
    const unreadViolations = violations.length;

    const formatTime = (ts) => {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // --- Shared render functions ---
    const latestTranscript = transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;

    useEffect(() => {
        if (latestTranscript?.text) {
            setSubtitleVisible(true);
            const timer = setTimeout(() => {
                setSubtitleVisible(false);
            }, 5000); // 5 seconds auto fade
            return () => clearTimeout(timer);
        }
    }, [latestTranscript?.text]);

    const renderOrbArea = () => (
        <div className="orb-area">
            {latestTranscript && (
                <div className={`live-subtitle ${latestTranscript.role} ${!subtitleVisible ? 'hidden' : ''}`}>
                    <span className="subtitle-role">{latestTranscript.role === 'agent' ? 'Fraud Check' : 'You'}</span>
                    <p className="subtitle-text">{latestTranscript.text}</p>
                </div>
            )}
            <button
                className={`orb-btn ${orbState} ${!isConnected ? 'disabled' : ''}`}
                onClick={isConnected ? toggleRecording : undefined}
                disabled={!isConnected}
            >
                <div className={`orb ${orbState}`}>
                    <div className="orb-glow" />
                    <div className="orb-ring ring-3" />
                    <div className="orb-ring ring-2" />
                    <div className="orb-ring ring-1" />
                    <div className="orb-core">
                        <div className="orb-gradient-mesh" />
                        <div className="orb-icon-wrap">
                            {agentSpeaking
                                ? <Volume2 size={48} className="orb-icon" />
                                : isRecording
                                    ? <MicOff size={48} className="orb-icon" />
                                    : <Mic size={48} className="orb-icon" />
                            }
                        </div>
                    </div>
                </div>
            </button>
            <p className={`orb-status ${orbState !== 'idle' ? 'active' : ''}`}>{statusText}</p>
            <input type="file" accept="image/*" ref={imgInputRef} style={{ display: 'none' }} onChange={handlePhotoUpload} />
            <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} style={{ display: 'none' }} onChange={handlePhotoUpload} />
            <div className="evidence-buttons">
                <button className={`upload-btn ${!isConnected ? 'disabled' : ''}`} onClick={() => imgInputRef.current?.click()} disabled={!isConnected}>
                    <Image size={16} /> Upload Evidence
                </button>
                <button className={`upload-btn ${!isConnected ? 'disabled' : ''}`} onClick={() => cameraInputRef.current?.click()} disabled={!isConnected}>
                    <Camera size={16} /> Take Photo
                </button>
                <button className={`live-session-btn ${!isConnected ? 'disabled' : ''}`} onClick={toggleLiveSession} disabled={!isConnected}>
                    <Video size={16} /> Live Session
                </button>
            </div>

            {/* Scenario buttons — show when idle and no conversation yet */}
            {transcripts.length === 0 && !isRecording && !agentSpeaking && (
                <div className="scenario-buttons">
                    {scenarios.map((s, i) => (
                        <button key={s.text} className="scenario-btn" style={{ animationDelay: `${i * 0.08}s` }} onClick={() => handleScenario(s.text)} disabled={!isConnected}>
                            <span className="scenario-icon">{s.icon}</span>
                            <span className="scenario-text">{s.text}</span>
                            <span className="scenario-sub">{s.sub}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Live violation chips */}
            {violations.length > 0 && (
                <div className="live-violations">
                    {violations.map(v => (
                        <div key={v.id} className="violation-chip">
                            <AlertTriangle size={14} />
                            <span className="violation-chip-section">{v.section}</span>
                            <span className="violation-chip-law">{v.law}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderCameraArea = () => (
        <div className="camera-area">
            <div className="camera-feed-container" onClick={captureFrame}>
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="camera-feed"
                />
                {!isCameraReady && (
                    <div className="camera-placeholder">
                        <Video size={48} />
                        <p>Starting camera...</p>
                    </div>
                )}
                <div className="camera-tap-hint">
                    <span>Tap to capture</span>
                </div>
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="camera-controls">
                <button className="live-session-btn active" onClick={toggleLiveSession}>
                    <Video size={16} /> End Live Session
                </button>
            </div>
        </div>
    );

    const renderTranscriptBubble = (t) => (
        <div key={t.id} className={`transcript-bubble ${t.role}`}>
            <div className="bubble-header">
                <span className="role">{t.role === 'agent' ? 'Fraud Check' : 'You'}</span>
                <span className="bubble-time"><Clock size={10} /> {formatTime(t.id)}</span>
            </div>
            <div className="transcript-text">{t.text}</div>

            {t.evidencePreview && (
                <div className="evidence-preview">
                    <img src={t.evidencePreview} alt="Evidence" />
                </div>
            )}

            {t.violations && t.violations.length > 0 && (
                <div className="bubble-violations">
                    {t.violations.map(v => (
                        <div key={v.id} className={`violation-card ${expandedViolations.has(v.id) ? 'expanded' : ''}`}>
                            <div className="violation-top" onClick={() => toggleViolationExpand(v.id)}>
                                <AlertTriangle size={14} />
                                <span className="violation-section">{v.section}</span>
                                <span className="violation-law">{v.law}</span>
                                {expandedViolations.has(v.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>
                            {expandedViolations.has(v.id) && (
                                <div className="violation-detail">
                                    <p className="violation-text">{v.violation}</p>
                                    <div className="violation-action">
                                        <ArrowRight size={12} />
                                        <span>{v.next_step}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {t.draft && (
                <div className="email-draft-card">
                    <div className="email-header"><Mail size={14} /> <span>Draft Ready to Send</span></div>
                    <div className="email-field"><strong>To:</strong> {t.draft.to}</div>
                    <div className="email-field"><strong>Subject:</strong> {t.draft.subject}</div>
                    <div className="email-body">{t.draft.raw}</div>
                    {lastEvidence && (
                        <div className="email-attachment">
                            <Image size={14} />
                            <span>Attached: {lastEvidence.name}</span>
                        </div>
                    )}
                    <button
                        className={`send-email-btn ${sentEmails.has(t.id) ? 'sent' : ''}`}
                        onClick={() => triggerSendEmail(t.draft, t.id)}
                        disabled={sendingEmailId === t.id || sentEmails.has(t.id)}
                    >
                        {sentEmails.has(t.id) ? (
                            <><CheckCircle size={14} /> Sent Successfully</>
                        ) : sendingEmailId === t.id ? (
                            <><Send size={14} className="spinning" /> Sending...</>
                        ) : (
                            <><Send size={14} /> {googleToken ? 'Send via Gmail' : 'Sign in with Google to Send'}</>
                        )}
                    </button>
                </div>
            )}
        </div>
    );

    const renderTranscriptArea = () => (
        <div className="transcript-area">
            {transcripts.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-orb-icon"><Mic size={24} /></div>
                    <p>Start speaking to see the live transcript...</p>
                </div>
            ) : (
                <>
                    {transcripts.map(renderTranscriptBubble)}
                    {agentSpeaking && (
                        <div className="transcript-bubble agent">
                            <div className="bubble-header"><span className="role">Fraud Check</span></div>
                            <div className="typing-indicator">
                                <span /><span /><span />
                            </div>
                        </div>
                    )}
                </>
            )}
            <div ref={transcriptEndRef} />
        </div>
    );

    return (
        <div className="live-container">
            <div className={`bg-gradient ${orbState}`} />

            {/* Glass top bar */}
            <div className="top-bar">
                <div className="brand">
                    <span className="shield">{'\u{1F6E1}\uFE0F'}</span>
                    <h1>Fraud Check</h1>
                </div>
                <div className="top-bar-right">
                    {transcripts.length > 0 && (
                        <button className="new-session-btn" onClick={handleNewSession}>
                            <RotateCcw size={14} /> New
                        </button>
                    )}
                    <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
                        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                    <div className={`connection-badge ${isConnected ? 'online' : ''}`}>
                        <span className="dot" />
                        {isConnected ? 'Connected' : 'Offline'}
                    </div>
                </div>
            </div>

            {/* Mobile: Tab switcher */}
            <div className="tab-bar">
                <button className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
                    <Radio size={16} />
                    <span>Live</span>
                </button>
                {isLiveSession && (
                    <button className={`tab-btn ${activeTab === 'camera' ? 'active' : ''}`} onClick={() => setActiveTab('camera')}>
                        <Video size={16} />
                        <span>Camera</span>
                    </button>
                )}
                <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
                    <MessageSquareText size={16} />
                    <span>Transcript</span>
                    {unreadViolations > 0 && activeTab !== 'transcript' && (
                        <span className="tab-badge">{unreadViolations}</span>
                    )}
                </button>
            </div>

            {/* Desktop: 2-panel layout */}
            {isDesktop ? (
                <div className="desktop-panels">
                    <div className="panel-live">
                        <div className="panel-header">
                            {isLiveSession ? <><Video size={14} /><span>Live Camera</span></> : <><Radio size={14} /><span>Live</span></>}
                        </div>
                        <div className="tab-content live-tab">
                            {isLiveSession ? renderCameraArea() : renderOrbArea()}
                        </div>
                    </div>
                    <div className="panel-transcript">
                        <div className="panel-header">
                            <MessageSquareText size={14} />
                            <span>Transcript</span>
                            {unreadViolations > 0 && <span className="tab-badge">{unreadViolations}</span>}
                        </div>
                        <div className="tab-content transcript-tab">
                            {renderTranscriptArea()}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {activeTab === 'live' && (
                        <div className="tab-content live-tab">
                            {isLiveSession ? renderCameraArea() : renderOrbArea()}
                        </div>
                    )}
                    {activeTab === 'camera' && (
                        <div className="tab-content live-tab">
                            {renderCameraArea()}
                        </div>
                    )}
                    {activeTab === 'transcript' && (
                        <div className="tab-content transcript-tab">
                            {renderTranscriptArea()}
                        </div>
                    )}
                </>
            )}

            {/* Toast */}
            {toast && (
                <div className={`toast toast-${toast.type}`}>
                    {toast.type === 'error' && <WifiOff size={16} />}
                    {toast.type === 'success' && <CheckCircle size={16} />}
                    <span>{toast.message}</span>
                    <button className="toast-close" onClick={() => setToast(null)}><X size={14} /></button>
                </div>
            )}

            {/* Onboarding overlay */}
            {showOnboarding && (
                <div className="onboarding-overlay">
                    <div className="onboarding-card">
                        <span className="onboarding-shield">{'\u{1F6E1}\uFE0F'}</span>
                        <h2>Welcome to Fraud Check</h2>
                        <p className="onboarding-tagline">Your AI-powered consumer rights companion</p>
                        <div className="onboarding-steps">
                            <div className="onboarding-step" style={{ animationDelay: '0.1s' }}>
                                <div className="step-number">1</div>
                                <div className="onboarding-icon"><Mic size={24} /></div>
                                <p>Tell us your problem</p>
                            </div>
                            <div className="step-connector" />
                            <div className="onboarding-step" style={{ animationDelay: '0.25s' }}>
                                <div className="step-number">2</div>
                                <div className="onboarding-icon"><Scale size={24} /></div>
                                <p>We'll find the law</p>
                            </div>
                            <div className="step-connector" />
                            <div className="onboarding-step" style={{ animationDelay: '0.4s' }}>
                                <div className="step-number">3</div>
                                <div className="onboarding-icon"><Zap size={24} /></div>
                                <p>Take action</p>
                            </div>
                        </div>
                        <button className="onboarding-btn" onClick={dismissOnboarding}>Get Started</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
