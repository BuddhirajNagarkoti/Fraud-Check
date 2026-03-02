import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, AlertTriangle, Scale, ArrowRight, MessageSquareText, Radio } from 'lucide-react';
import useWebSocket from 'react-use-websocket';
import './index.css';

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [agentSpeaking, setAgentSpeaking] = useState(false);
    const [transcripts, setTranscripts] = useState([]);
    const [violations, setViolations] = useState([]);
    const [activeTab, setActiveTab] = useState('live');

    const playbackCtxRef = useRef(null);
    const micCleanupRef = useRef(null);
    const playbackTimeRef = useRef(0);
    const speakingTimeoutRef = useRef(null);
    const transcriptEndRef = useRef(null);

    const agentSpeakingRef = useRef(false);
    useEffect(() => { agentSpeakingRef.current = agentSpeaking; }, [agentSpeaking]);

    const { sendMessage, lastMessage, readyState } = useWebSocket('ws://localhost:8002', {
        shouldReconnect: () => true,
    });

    useEffect(() => {
        setIsConnected(readyState === 1);
    }, [readyState]);

    // Auto-scroll transcripts
    useEffect(() => {
        if (activeTab === 'transcript') {
            transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcripts, activeTab]);

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
        }
    };

    const stopRecording = () => {
        if (micCleanupRef.current) {
            micCleanupRef.current();
            micCleanupRef.current = null;
        }
        setIsRecording(false);
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

    return (
        <div className="live-container">
            <div className={`bg-gradient ${isRecording ? 'listening' : ''}`} />

            {/* Top bar */}
            <div className="top-bar">
                <div className="brand">
                    <span className="shield">🛡️</span>
                    <h1>Fraud Check</h1>
                </div>
                <div className={`connection-badge ${isConnected ? 'online' : ''}`}>
                    <span className="dot" />
                    {isConnected ? 'Connected' : 'Offline'}
                </div>
            </div>

            {/* Tab switcher */}
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

            {/* ===== LIVE TAB ===== */}
            {activeTab === 'live' && (
                <div className="tab-content live-tab">
                    {/* Clickable Orb */}
                    <div className="orb-area">
                        <button
                            className={`orb-btn ${orbState} ${!isConnected ? 'disabled' : ''}`}
                            onClick={isConnected ? toggleRecording : undefined}
                            disabled={!isConnected}
                        >
                            <div className={`orb ${orbState}`}>
                                <div className="orb-core">
                                    {isRecording
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
                    </div>
                </div>
            )}

            {/* ===== TRANSCRIPT TAB ===== */}
            {activeTab === 'transcript' && (
                <div className="tab-content transcript-tab">
                    {/* Transcript chat */}
                    <div className="transcript-area">
                        {transcripts.length === 0 ? (
                            <div className="transcript-placeholder">
                                Start speaking to see the live transcript...
                            </div>
                        ) : (
                            transcripts.map((t) => (
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
                                </div>
                            ))
                        )}
                        <div ref={transcriptEndRef} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
