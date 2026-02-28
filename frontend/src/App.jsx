import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Camera, X, Info, Copy, FileText, CheckCheck } from 'lucide-react';
import './index.css';

// Configurable via .env — falls back to local dev backend
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/stream';

// Gemini Live outputs raw PCM mono at 24 kHz
const GEMINI_OUTPUT_SAMPLE_RATE = 24000;

// ============================================================================
// Infographic data: maps topic keywords → legal rights cards
// ============================================================================
const INFOGRAPHIC_DB = {
    return: {
        title: 'Return & Refund Rights',
        emoji: '↩️',
        rights: [
            'You have 7 days to return defective or misdescribed goods (Section 16)',
            'Full refund required for substandard products',
            'Seller cannot refuse a lawful return request',
            'E-commerce orders: 7-day no-questions return window',
        ],
    },
    refund: {
        title: 'Refund Rights',
        emoji: '💰',
        rights: [
            'Right to full refund for defective goods',
            'Refund must be processed within 15 working days',
            'Cash refund cannot be replaced with vouchers without consent',
            'Report refusal to DCSCP or call Hello Sarkar: 1111',
        ],
    },
    price: {
        title: 'Pricing Violations',
        emoji: '🏷️',
        rights: [
            'Selling above Maximum Retail Price (MRP) is illegal — Section 50',
            'Hidden fees are prohibited under E-Commerce Directive 2082',
            'False discounts (inflated original price) are punishable',
            'Fine of up to NPR 50,000 for price violations',
        ],
    },
    fraud: {
        title: 'E-Commerce Fraud',
        emoji: '🚨',
        rights: [
            'Platform must deliver exactly what was advertised online',
            'Mandatory grievance handling mechanism required by law',
            'Fake reviews or misleading ads are punishable offences',
            'File complaint at Hello Sarkar (1111) or DCSCP',
        ],
    },
    delivery: {
        title: 'Delivery Rights',
        emoji: '📦',
        rights: [
            'Late delivery without notice is a consumer rights violation',
            'You can refuse delivery of a damaged package',
            'Platform is responsible for items lost in transit',
            'E-Commerce Directive 2082 mandates delivery as promised',
        ],
    },
    default: {
        title: 'Your Consumer Rights',
        emoji: '🛡️',
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
    const key = Object.keys(INFOGRAPHIC_DB).find(
        k => k !== 'default' && lower.includes(k)
    );
    return INFOGRAPHIC_DB[key || 'default'];
}

// ============================================================================
// App Component
// ============================================================================
function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [infographic, setInfographic] = useState(null); // topic string
    const [complaintDraft, setComplaintDraft] = useState(null);
    const [copied, setCopied] = useState(false);

    // Refs
    const wsRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);

    // Recording refs
    const recordingCtxRef = useRef(null);
    const processorRef = useRef(null);
    const sourceRef = useRef(null);
    const micStreamRef = useRef(null);

    // Playback refs
    const playbackCtxRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isPlayingRef = useRef(false);

    // Camera refs
    const videoRef = useRef(null);
    const videoStreamRef = useRef(null);

    // Logs scroll ref
    const logsEndRef = useRef(null);

    const addMessage = useCallback((text) => {
        setMessages(prev => [
            ...prev,
            { text, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) },
        ]);
    }, []);

    // Auto-scroll logs to bottom
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // -----------------------------------------------------------------------
    // WebSocket connection with auto-reconnect
    // -----------------------------------------------------------------------
    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            setIsConnected(true);
            reconnectAttemptRef.current = 0;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };

        ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                switch (msg.type) {
                    case 'audio':
                        enqueueAudio(msg.data);
                        break;
                    case 'text':
                        if (msg.data?.trim()) addMessage(`🤖 ${msg.data.trim()}`);
                        break;
                    case 'tool_call':
                        addMessage(
                            msg.name === 'generate_complaint_draft'
                                ? '⚙️ Generating complaint draft...'
                                : '⚙️ Preparing legal infographic...'
                        );
                        break;
                    case 'complaint_draft':
                        setComplaintDraft(msg.data);
                        addMessage('✅ Complaint draft is ready below!');
                        break;
                    case 'infographic':
                        setInfographic(msg.topic);
                        addMessage(`📋 Showing your rights: ${msg.topic}`);
                        break;
                    case 'error':
                        addMessage(`⚠️ ${msg.data}`);
                        break;
                    default:
                        break;
                }
            } catch (err) {
                console.error('Message parse error', err);
            }
        };

        ws.onclose = () => {
            setIsConnected(false);
            // Exponential backoff: 2s, 4s, 8s … capped at 30s
            const delay = Math.min(2000 * 2 ** reconnectAttemptRef.current, 30000);
            reconnectAttemptRef.current += 1;
            reconnectTimerRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => {
            ws.close(); // trigger onclose → reconnect
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        connect();
        return () => {
            clearTimeout(reconnectTimerRef.current);
            wsRef.current?.close();
        };
    }, [connect]);

    // -----------------------------------------------------------------------
    // Audio Playback — raw PCM Int16 from Gemini (24 kHz mono)
    // -----------------------------------------------------------------------
    const enqueueAudio = (base64Data) => {
        audioQueueRef.current.push(base64Data);
        if (!isPlayingRef.current) playNextChunk();
    };

    const playNextChunk = async () => {
        if (audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            return;
        }
        isPlayingRef.current = true;
        const b64 = audioQueueRef.current.shift();

        try {
            // Lazily create playback context
            if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
                playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (playbackCtxRef.current.state === 'suspended') {
                await playbackCtxRef.current.resume();
            }

            // Decode base64 → bytes
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            // Convert raw PCM Int16 → Float32
            const int16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

            // Create buffer at Gemini's output rate; browser resamples automatically
            const buf = playbackCtxRef.current.createBuffer(1, float32.length, GEMINI_OUTPUT_SAMPLE_RATE);
            buf.getChannelData(0).set(float32);

            const src = playbackCtxRef.current.createBufferSource();
            src.buffer = buf;
            src.connect(playbackCtxRef.current.destination);
            src.onended = playNextChunk;
            src.start(0);
        } catch (err) {
            console.error('Audio playback error:', err);
            isPlayingRef.current = false;
            playNextChunk(); // skip broken chunk
        }
    };

    // -----------------------------------------------------------------------
    // Audio Recording — raw PCM Int16 at 16 kHz via ScriptProcessor
    // -----------------------------------------------------------------------
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
            });
            micStreamRef.current = stream;

            // AudioContext at 16 kHz — Chrome honours this; other browsers will resample
            const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            recordingCtxRef.current = ctx;

            const source = ctx.createMediaStreamSource(stream);
            // ScriptProcessor is deprecated but universally supported; AudioWorklet
            // would require a separate worker file. 4096-sample buffers ≈ 256 ms.
            const processor = ctx.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (e) => {
                if (wsRef.current?.readyState !== WebSocket.OPEN) return;

                const float32 = e.inputBuffer.getChannelData(0);

                // Float32 → Int16 PCM
                const int16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    int16[i] = Math.max(-32768, Math.min(32767, Math.floor(float32[i] * 32768)));
                }

                // Int16 bytes → base64
                const bytes = new Uint8Array(int16.buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                const base64 = btoa(binary);

                wsRef.current.send(JSON.stringify({ audio: base64 }));
            };

            // ScriptProcessor requires a destination connection to fire
            source.connect(processor);
            processor.connect(ctx.destination);

            processorRef.current = processor;
            sourceRef.current = source;

            setIsRecording(true);
            addMessage('🎤 Listening — tell me your problem...');
        } catch (err) {
            console.error('Microphone error:', err);
            addMessage('⚠️ Could not access microphone. Please allow microphone permission.');
        }
    };

    const stopRecording = () => {
        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();
        recordingCtxRef.current?.close();
        micStreamRef.current?.getTracks().forEach(t => t.stop());

        processorRef.current = null;
        sourceRef.current = null;
        recordingCtxRef.current = null;
        micStreamRef.current = null;

        setIsRecording(false);
        addMessage('🛑 Stopped listening.');
    };

    // -----------------------------------------------------------------------
    // Camera — receipt / bill scanning
    // -----------------------------------------------------------------------
    const openCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            });
            videoStreamRef.current = stream;
            setIsCameraOpen(true);
        } catch (err) {
            console.error('Camera error:', err);
            addMessage('⚠️ Camera access denied. Please allow camera permission and try again.');
        }
    };

    // Wire the stream to the video element after the modal appears in the DOM
    useEffect(() => {
        if (isCameraOpen && videoRef.current && videoStreamRef.current) {
            videoRef.current.srcObject = videoStreamRef.current;
            videoRef.current.play().catch(console.error);
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
            addMessage('📸 Receipt image sent — analysing...');
        }
        closeCamera();
    };

    const closeCamera = () => {
        videoStreamRef.current?.getTracks().forEach(t => t.stop());
        videoStreamRef.current = null;
        setIsCameraOpen(false);
    };

    // -----------------------------------------------------------------------
    // Copy complaint to clipboard
    // -----------------------------------------------------------------------
    const copyComplaint = () => {
        if (!complaintDraft) return;
        navigator.clipboard.writeText(complaintDraft).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        });
    };

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    return (
        <div className="app">
            {/* ── Header ── */}
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

            {/* ── Controls ── */}
            <div className="card controls">
                <button
                    className={`btn btn--primary${isRecording ? ' btn--recording' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={!isConnected}
                    aria-label={isRecording ? 'Stop listening' : 'Start talking to agent'}
                >
                    {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                    <span>{isRecording ? 'Stop Listening' : 'Talk to Agent'}</span>
                </button>

                <button
                    className="btn btn--secondary"
                    onClick={openCamera}
                    disabled={!isConnected}
                    aria-label="Scan receipt or bill"
                >
                    <Camera size={20} />
                    <span>Scan Receipt</span>
                </button>
            </div>

            {/* ── Conversation log ── */}
            <div className="card">
                <p className="section-label">Conversation</p>
                <div className="logs" role="log" aria-live="polite">
                    {messages.length === 0 && (
                        <div className="logs__empty">
                            <p>
                                Try saying: <em>"I ordered a phone online but received a different model…"</em>
                            </p>
                            <p className="hint-nepali">अथवा नेपालीमा बोल्नुहोस् — "मैले अनलाइनबाट किनेको सामान आएन।"</p>
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

            {/* ── Complaint draft ── */}
            {complaintDraft && (
                <div className="card complaint">
                    <div className="complaint__header">
                        <h3 className="complaint__title">
                            <FileText size={18} />
                            Complaint Draft
                        </h3>
                        <button
                            className={`btn-copy${copied ? ' btn-copy--done' : ''}`}
                            onClick={copyComplaint}
                            aria-label="Copy complaint to clipboard"
                        >
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

            {/* ── Infographic card ── */}
            {infographic && (
                <div className="card infographic">
                    <p className="section-label">
                        <Info size={14} /> Know Your Rights
                    </p>
                    {(() => {
                        const data = getInfoData(infographic);
                        return (
                            <>
                                <h3 className="infographic__title">
                                    {data.emoji} {data.title}
                                </h3>
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

            {/* ── Camera modal ── */}
            {isCameraOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Scan receipt">
                    <div className="modal">
                        <div className="modal__header">
                            <h3 className="modal__title">
                                <Camera size={18} /> Scan Receipt / Bill
                            </h3>
                            <button className="btn-icon" onClick={closeCamera} aria-label="Close camera">
                                <X size={20} />
                            </button>
                        </div>

                        <video
                            ref={videoRef}
                            className="camera-preview"
                            autoPlay
                            playsInline
                            muted
                        />

                        <div className="modal__footer">
                            <button className="btn btn--capture" onClick={capturePhoto}>
                                📸 Capture &amp; Send to Agent
                            </button>
                            <button className="btn btn--secondary" onClick={closeCamera}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
