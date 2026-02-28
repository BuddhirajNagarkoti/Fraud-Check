import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Camera, X, Info, Copy, FileText, CheckCheck, Volume2 } from 'lucide-react';
import './index.css';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/stream';
const GEMINI_OUTPUT_SAMPLE_RATE = 24000;

// ── Infographic data ─────────────────────────────────────────────────────────
const INFOGRAPHIC_DB = {
    return: {
        title: 'Return & Refund Rights', emoji: '↩️',
        rights: [
            '7 days to return defective or misdescribed goods (Section 16)',
            'Full refund required for substandard products',
            'Seller cannot refuse a lawful return request',
            'E-commerce: 7-day no-questions return window',
        ],
    },
    refund: {
        title: 'Refund Rights', emoji: '💰',
        rights: [
            'Right to full refund for defective goods',
            'Refund must be processed within 15 working days',
            'Cash refund cannot be replaced with vouchers without consent',
            'Report refusal to DCSCP or call Hello Sarkar: 1111',
        ],
    },
    price: {
        title: 'Pricing Violations', emoji: '🏷️',
        rights: [
            'Selling above MRP is illegal — Section 50',
            'Hidden fees are prohibited under E-Commerce Directive 2082',
            'False discounts (inflated original price) are punishable',
            'Fine of up to NPR 50,000 for price violations',
        ],
    },
    fraud: {
        title: 'E-Commerce Fraud', emoji: '🚨',
        rights: [
            'Platform must deliver exactly what was advertised',
            'Mandatory grievance handling mechanism required by law',
            'Fake reviews or misleading ads are punishable offences',
            'File complaint at Hello Sarkar (1111) or DCSCP',
        ],
    },
    delivery: {
        title: 'Delivery Rights', emoji: '📦',
        rights: [
            'Late delivery without notice is a consumer rights violation',
            'You can refuse delivery of a damaged package',
            'Platform is responsible for items lost in transit',
            'E-Commerce Directive 2082 mandates delivery as promised',
        ],
    },
    default: {
        title: 'Your Consumer Rights', emoji: '🛡️',
        rights: [
            'Right to safety from harmful goods and services',
            'Right to accurate information about price and quality',
            'Right to compensation for unfair trade practices',
            'Right to be heard — file complaints with DCSCP or Hello Sarkar: 1111',
        ],
    },
};

function getInfoData(topic) {
    const lower = (topic || '').toLowerCase();
    const key = Object.keys(INFOGRAPHIC_DB).find(k => k !== 'default' && lower.includes(k));
    return INFOGRAPHIC_DB[key || 'default'];
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
    // Connection
    const [isConnected, setIsConnected] = useState(false);

    // Conversation state
    const [isLive, setIsLive] = useState(false);       // mic stream active
    const [isMuted, setIsMuted] = useState(false);     // sending audio paused
    const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
    const [voiceLevel, setVoiceLevel] = useState(0);   // 0-1 RMS

    // UI
    const [messages, setMessages] = useState([]);
    const [infographic, setInfographic] = useState(null);
    const [complaintDraft, setComplaintDraft] = useState(null);
    const [copied, setCopied] = useState(false);
    const [isCameraOpen, setIsCameraOpen] = useState(false);

    // Refs
    const wsRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);

    const recordingCtxRef = useRef(null);
    const processorRef = useRef(null);
    const sourceRef = useRef(null);
    const micStreamRef = useRef(null);
    const isMutedRef = useRef(false);  // sync ref for onaudioprocess closure

    const playbackCtxRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isPlayingRef = useRef(false);
    const nextPlayTimeRef = useRef(0);  // schedule chunks back-to-back

    const videoRef = useRef(null);
    const videoStreamRef = useRef(null);
    const logsEndRef = useRef(null);

    const addMessage = useCallback((text) => {
        setMessages(prev => [...prev, {
            text,
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        }]);
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── WebSocket ────────────────────────────────────────────────────────────
    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            setIsConnected(true);
            reconnectAttemptRef.current = 0;
            clearTimeout(reconnectTimerRef.current);
        };

        ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                switch (msg.type) {
                    case 'audio':      enqueueAudio(msg.data); break;
                    case 'text':       if (msg.data?.trim()) addMessage(`🤖 ${msg.data.trim()}`); break;
                    case 'tool_call':
                        addMessage(msg.name === 'generate_complaint_draft'
                            ? '⚙️ Generating complaint draft…'
                            : '⚙️ Preparing legal infographic…');
                        break;
                    case 'complaint_draft':
                        setComplaintDraft(msg.data);
                        addMessage('✅ Complaint draft is ready below!');
                        break;
                    case 'infographic':
                        setInfographic(msg.topic);
                        addMessage(`📋 Showing your rights: ${msg.topic}`);
                        break;
                    case 'error':      addMessage(`⚠️ ${msg.data}`); break;
                }
            } catch { /* ignore */ }
        };

        ws.onclose = () => {
            setIsConnected(false);
            const delay = Math.min(2000 * 2 ** reconnectAttemptRef.current, 30000);
            reconnectAttemptRef.current += 1;
            reconnectTimerRef.current = setTimeout(connect, delay);
        };
        ws.onerror = () => ws.close();
    }, []); // eslint-disable-line

    useEffect(() => {
        connect();
        return () => {
            clearTimeout(reconnectTimerRef.current);
            wsRef.current?.close();
        };
    }, [connect]);

    // ── Audio Playback ───────────────────────────────────────────────────────
    // Chunks are scheduled back-to-back using AudioContext.currentTime for
    // seamless playback with no gaps between consecutive audio packets.
    const enqueueAudio = (b64) => {
        audioQueueRef.current.push(b64);
        if (!isPlayingRef.current) drainQueue();
    };

    const drainQueue = async () => {
        if (audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            setIsAgentSpeaking(false);
            return;
        }
        isPlayingRef.current = true;
        setIsAgentSpeaking(true);

        // Lazily create / resume the playback context
        if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
            playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            nextPlayTimeRef.current = 0;
        }
        if (playbackCtxRef.current.state === 'suspended') {
            await playbackCtxRef.current.resume();
        }

        while (audioQueueRef.current.length > 0) {
            const b64 = audioQueueRef.current.shift();
            try {
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

                const int16 = new Int16Array(bytes.buffer);
                const float32 = new Float32Array(int16.length);
                for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

                const buf = playbackCtxRef.current.createBuffer(1, float32.length, GEMINI_OUTPUT_SAMPLE_RATE);
                buf.getChannelData(0).set(float32);

                const src = playbackCtxRef.current.createBufferSource();
                src.buffer = buf;
                src.connect(playbackCtxRef.current.destination);

                // Schedule immediately after the previous chunk ends
                const startAt = Math.max(playbackCtxRef.current.currentTime, nextPlayTimeRef.current);
                src.start(startAt);
                nextPlayTimeRef.current = startAt + buf.duration;
            } catch { /* skip corrupt chunk */ }
        }

        // Poll until scheduled audio finishes
        const poll = setInterval(() => {
            if (!playbackCtxRef.current) { clearInterval(poll); return; }
            if (playbackCtxRef.current.currentTime >= nextPlayTimeRef.current - 0.05) {
                clearInterval(poll);
                isPlayingRef.current = false;
                setIsAgentSpeaking(false);
                // Drain any chunks that arrived while we were playing
                if (audioQueueRef.current.length > 0) drainQueue();
            }
        }, 100);
    };

    // ── Microphone — always-on PCM stream ───────────────────────────────────
    const startConversation = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
            });
            micStreamRef.current = stream;

            const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            recordingCtxRef.current = ctx;

            const source = ctx.createMediaStreamSource(stream);
            const processor = ctx.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (e) => {
                const float32 = e.inputBuffer.getChannelData(0);

                // Compute RMS for voice level indicator
                let sum = 0;
                for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
                const rms = Math.sqrt(sum / float32.length);
                setVoiceLevel(Math.min(rms * 6, 1)); // scale up for visibility

                // Skip sending if muted or WS not open
                if (isMutedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

                // Float32 → Int16 PCM → base64
                const int16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    int16[i] = Math.max(-32768, Math.min(32767, Math.floor(float32[i] * 32768)));
                }
                const bytes = new Uint8Array(int16.buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                wsRef.current.send(JSON.stringify({ audio: btoa(binary) }));
            };

            source.connect(processor);
            processor.connect(ctx.destination);
            processorRef.current = processor;
            sourceRef.current = source;

            setIsLive(true);
            setIsMuted(false);
            isMutedRef.current = false;
            addMessage('🎙️ Live conversation started — just speak naturally!');
        } catch {
            addMessage('⚠️ Could not access microphone. Please allow microphone permission.');
        }
    };

    const endConversation = () => {
        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();
        recordingCtxRef.current?.close();
        micStreamRef.current?.getTracks().forEach(t => t.stop());
        processorRef.current = null;
        sourceRef.current = null;
        recordingCtxRef.current = null;
        micStreamRef.current = null;
        setIsLive(false);
        setIsMuted(false);
        setVoiceLevel(0);
        isMutedRef.current = false;
        addMessage('🔴 Conversation ended.');
    };

    const toggleMute = () => {
        const next = !isMuted;
        setIsMuted(next);
        isMutedRef.current = next;
        addMessage(next ? '🔇 Microphone muted.' : '🔊 Microphone unmuted.');
    };

    // ── Camera ───────────────────────────────────────────────────────────────
    const openCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            });
            videoStreamRef.current = stream;
            setIsCameraOpen(true);
        } catch {
            addMessage('⚠️ Camera access denied. Please allow camera permission and try again.');
        }
    };

    useEffect(() => {
        if (isCameraOpen && videoRef.current && videoStreamRef.current) {
            videoRef.current.srcObject = videoStreamRef.current;
            videoRef.current.play().catch(() => {});
        }
    }, [isCameraOpen]);

    const capturePhoto = () => {
        if (!videoRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ image: base64 }));
            addMessage('📸 Receipt image sent — analysing…');
        }
        closeCamera();
    };

    const closeCamera = () => {
        videoStreamRef.current?.getTracks().forEach(t => t.stop());
        videoStreamRef.current = null;
        setIsCameraOpen(false);
    };

    // ── Copy complaint ────────────────────────────────────────────────────────
    const copyComplaint = () => {
        if (!complaintDraft) return;
        navigator.clipboard.writeText(complaintDraft).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        });
    };

    // ── Status label ─────────────────────────────────────────────────────────
    const statusLabel = !isLive
        ? null
        : isMuted
            ? '🔇 Muted'
            : isAgentSpeaking
                ? '🔊 Agent speaking…'
                : voiceLevel > 0.05
                    ? '🎙️ Listening…'
                    : '💬 Say something…';

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="app">
            {/* Header */}
            <header className="header">
                <div className="header-text">
                    <h1 className="header-title">Fraud Check 🛡️</h1>
                    <p className="header-sub">
                        तपाईंको उपभोक्ता अधिकार रक्षक &middot; Your Consumer Rights Companion
                    </p>
                </div>
                <div className={`badge ${isConnected ? 'badge--online' : 'badge--offline'}`}>
                    <span className="badge__dot" />
                    {isConnected ? 'Agent Online' : 'Reconnecting…'}
                </div>
            </header>

            {/* Live conversation panel */}
            <div className="card live-panel">
                {!isLive ? (
                    /* ── Start state ── */
                    <div className="live-start">
                        <button
                            className="btn-start-conversation"
                            onClick={startConversation}
                            disabled={!isConnected}
                            aria-label="Start live conversation"
                        >
                            <Mic size={28} />
                            Start Conversation
                        </button>
                        <p className="live-hint">
                            Tap once — then just speak naturally.<br />
                            No clicking between turns.
                        </p>
                    </div>
                ) : (
                    /* ── Live state ── */
                    <div className="live-active">
                        {/* Central orb: pulses with voice or agent activity */}
                        <div className={`orb ${isAgentSpeaking ? 'orb--agent' : isMuted ? 'orb--muted' : voiceLevel > 0.05 ? 'orb--speaking' : 'orb--idle'}`}
                            style={{ '--level': voiceLevel }}
                        >
                            {isAgentSpeaking
                                ? <Volume2 size={32} />
                                : isMuted
                                    ? <MicOff size={32} />
                                    : <Mic size={32} />}
                        </div>

                        {/* Status */}
                        {statusLabel && <p className="live-status">{statusLabel}</p>}

                        {/* Controls */}
                        <div className="live-controls">
                            <button
                                className={`btn btn--secondary${isMuted ? ' btn--muted-active' : ''}`}
                                onClick={toggleMute}
                                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                            >
                                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                                {isMuted ? 'Unmute' : 'Mute'}
                            </button>
                            <button
                                className="btn btn--secondary"
                                onClick={openCamera}
                                aria-label="Scan receipt"
                            >
                                <Camera size={18} />
                                Scan Receipt
                            </button>
                            <button
                                className="btn btn--end"
                                onClick={endConversation}
                                aria-label="End conversation"
                            >
                                End
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Conversation log */}
            <div className="card">
                <p className="section-label">Conversation</p>
                <div className="logs" role="log" aria-live="polite">
                    {messages.length === 0 && (
                        <div className="logs__empty">
                            <p>
                                Tap <strong>Start Conversation</strong> and describe your problem —
                                e.g. <em>"I ordered a phone but got a different model"</em>
                            </p>
                            <p className="hint-nepali">
                                अथवा नेपालीमा बोल्नुहोस् — "मैले अनलाइनबाट किनेको सामान आएन।"
                            </p>
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <div key={i} className="log-entry">
                            <span className="log-time">{m.time}</span>
                            <p className="log-text">{m.text}</p>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>

            {/* Complaint draft */}
            {complaintDraft && (
                <div className="card complaint">
                    <div className="complaint__header">
                        <h3 className="complaint__title"><FileText size={18} /> Complaint Draft</h3>
                        <button className={`btn-copy${copied ? ' btn-copy--done' : ''}`} onClick={copyComplaint}>
                            {copied ? <CheckCheck size={15} /> : <Copy size={15} />}
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                    <pre className="complaint__body">{complaintDraft}</pre>
                    <p className="complaint__hint">
                        Submit via <strong>Hello Sarkar (1111)</strong> or visit your nearest <strong>DCSCP office</strong>.
                    </p>
                </div>
            )}

            {/* Infographic card */}
            {infographic && (
                <div className="card infographic">
                    <p className="section-label"><Info size={14} /> Know Your Rights</p>
                    {(() => {
                        const data = getInfoData(infographic);
                        return (
                            <>
                                <h3 className="infographic__title">{data.emoji} {data.title}</h3>
                                <ul className="rights-list">
                                    {data.rights.map((r, i) => (
                                        <li key={i} className="rights-list__item">{r}</li>
                                    ))}
                                </ul>
                                <p className="infographic__topic">Topic: {infographic}</p>
                            </>
                        );
                    })()}
                </div>
            )}

            {/* Camera modal */}
            {isCameraOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true">
                    <div className="modal">
                        <div className="modal__header">
                            <h3 className="modal__title"><Camera size={18} /> Scan Receipt / Bill</h3>
                            <button className="btn-icon" onClick={closeCamera}><X size={20} /></button>
                        </div>
                        <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
                        <div className="modal__footer">
                            <button className="btn btn--capture" onClick={capturePhoto}>📸 Capture &amp; Send</button>
                            <button className="btn btn--secondary" onClick={closeCamera}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
