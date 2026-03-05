import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, AlertTriangle, ArrowRight, MessageSquareText, Radio, Camera, Send, Mail, CheckCircle, Image, WifiOff, X, Sun, Moon } from 'lucide-react';
import useWebSocket from 'react-use-websocket';
import { useGoogleLogin } from '@react-oauth/google';
import './index.css';

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [agentSpeaking, setAgentSpeaking] = useState(false);
    const [transcripts, setTranscripts] = useState([]);
    const [violations, setViolations] = useState([]);
    const [activeTab, setActiveTab] = useState('live');
    const [googleToken, setGoogleToken] = useState(null);
    const [sendingEmailId, setSendingEmailId] = useState(null);
    const [sentEmails, setSentEmails] = useState(new Set());
    const [lastEvidence, setLastEvidence] = useState(null);
    const [toast, setToast] = useState(null);
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

    const agentSpeakingRef = useRef(false);
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

    // Auto-scroll transcripts
    useEffect(() => {
        if (isDesktop || activeTab === 'transcript') {
            transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcripts, activeTab, isDesktop]);

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
                    text: 'I just uploaded a photo as evidence. Please analyze this image and tell me what you see — does it support my complaint?'
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
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const orbState = agentSpeaking ? 'speaking' : isRecording ? 'listening' : 'idle';
    const statusText = agentSpeaking ? 'Speaking' : isRecording ? 'Listening...' : isConnected ? 'Tap to start' : 'Connecting...';
    const unreadViolations = violations.length;

    // --- Shared render functions ---
    const renderOrbArea = () => (
        <div className="orb-area">
            <button
                className={`orb-btn ${orbState} ${!isConnected ? 'disabled' : ''}`}
                onClick={isConnected ? toggleRecording : undefined}
                disabled={!isConnected}
            >
                <div className={`orb ${orbState}`}>
                    <div className="orb-core">
                        {agentSpeaking
                            ? <Volume2 size={28} className="orb-icon" />
                            : isRecording
                                ? <MicOff size={28} className="orb-icon" />
                                : <Mic size={28} className="orb-icon" />
                        }
                    </div>
                    <div className="orb-ring ring-1" />
                    <div className="orb-ring ring-2" />
                    <div className="orb-ring ring-3" />
                </div>
            </button>
            <p className={`orb-status ${orbState !== 'idle' ? 'active' : ''}`}>{statusText}</p>
            <input
                type="file"
                accept="image/*"
                ref={imgInputRef}
                style={{ display: 'none' }}
                onChange={handlePhotoUpload}
            />
            <button
                className={`upload-btn ${!isConnected ? 'disabled' : ''}`}
                onClick={() => imgInputRef.current?.click()}
                disabled={!isConnected}
            >
                <Camera size={18} /> Upload Evidence
            </button>
        </div>
    );

    const renderTranscriptBubble = (t) => (
        <div key={t.id} className={`transcript-bubble ${t.role}`}>
            <div className="role">{t.role === 'agent' ? 'Fraud Check' : t.role === 'user' ? 'You' : 'System'}</div>
            <div className="transcript-text">{t.text}</div>

            {t.violations && t.violations.length > 0 && (
                <div className="bubble-violations">
                    {t.violations.map(v => (
                        <div key={v.id} className="violation-card">
                            <div className="violation-top">
                                <AlertTriangle size={14} />
                                <span className="violation-section">{v.section}</span>
                                <span className="violation-law">{v.law}</span>
                            </div>
                            <p className="violation-text">{v.violation}</p>
                            <div className="violation-action">
                                <ArrowRight size={12} />
                                <span>{v.next_step}</span>
                            </div>
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
                <div className="transcript-placeholder">
                    Start speaking to see the live transcript...
                </div>
            ) : (
                transcripts.map(renderTranscriptBubble)
            )}
            <div ref={transcriptEndRef} />
        </div>
    );

    return (
        <div className="live-container">
            <div className={`bg-gradient ${isRecording ? 'listening' : ''}`} />

            {/* Top bar */}
            <div className="top-bar">
                <div className="brand">
                    <span className="shield">{'\u{1F6E1}\uFE0F'}</span>
                    <h1>Fraud Check</h1>
                </div>
                <div className="top-bar-right">
                    <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
                        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                    <div className={`connection-badge ${isConnected ? 'online' : ''}`}>
                        <span className="dot" />
                        {isConnected ? 'Connected' : 'Offline'}
                    </div>
                </div>
            </div>

            {/* Mobile: Tab switcher (hidden on desktop via CSS) */}
            <div className="tab-bar">
                <button
                    className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`}
                    onClick={() => setActiveTab('live')}
                >
                    <Radio size={16} />
                    <span>Live</span>
                </button>
                <button
                    className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
                    onClick={() => setActiveTab('transcript')}
                >
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
                            <Radio size={14} />
                            <span>Live</span>
                        </div>
                        <div className="tab-content live-tab">
                            {renderOrbArea()}
                        </div>
                    </div>
                    <div className="panel-transcript">
                        <div className="panel-header">
                            <MessageSquareText size={14} />
                            <span>Transcript</span>
                            {unreadViolations > 0 && (
                                <span className="tab-badge">{unreadViolations}</span>
                            )}
                        </div>
                        <div className="tab-content transcript-tab">
                            {renderTranscriptArea()}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* Mobile: tab content */}
                    {activeTab === 'live' && (
                        <div className="tab-content live-tab">
                            {renderOrbArea()}
                        </div>
                    )}
                    {activeTab === 'transcript' && (
                        <div className="tab-content transcript-tab">
                            {renderTranscriptArea()}
                        </div>
                    )}
                </>
            )}

            {/* Toast notification */}
            {toast && (
                <div className={`toast toast-${toast.type}`}>
                    {toast.type === 'error' && <WifiOff size={16} />}
                    {toast.type === 'success' && <CheckCircle size={16} />}
                    <span>{toast.message}</span>
                    <button className="toast-close" onClick={() => setToast(null)}><X size={14} /></button>
                </div>
            )}
        </div>
    );
}

export default App;
