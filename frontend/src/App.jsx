import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Camera, Info } from 'lucide-react';
import './index.css';

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [messages, setMessages] = useState([]);
    const [infographic, setInfographic] = useState(null);
    const audioContextRef = useRef(null);
    const wsRef = useRef(null);
    const mediaRecorderRef = useRef(null);

    useEffect(() => {
        // Connect to FastAPI WebSocket
        wsRef.current = new WebSocket('ws://localhost:8000/stream');

        wsRef.current.onopen = () => {
            console.log('Connected to backend');
            setIsConnected(true);
        };

        wsRef.current.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'audio') {
                    playAudio(message.data);
                } else if (message.type === 'tool_call') {
                    setMessages(prev => [...prev, `Agent is generating: ${message.name}...`]);
                } else if (message.action === 'render_infographic') {
                    setInfographic({ topic: message.topic, url: 'https://via.placeholder.com/400x300?text=Generated+Infographic+for+' + encodeURIComponent(message.topic) });
                }
            } catch (err) {
                console.error('Error parsing message', err);
            }
        };

        wsRef.current.onclose = () => setIsConnected(false);

        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    const playAudio = async (base64Audio) => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const binaryStr = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start(0);
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });

            mediaRecorderRef.current.ondataavailable = async (e) => {
                if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                    // Convert blob to base64
                    const reader = new FileReader();
                    reader.readAsDataURL(e.data);
                    reader.onloadend = () => {
                        const base64data = reader.result.split(',')[1];
                        wsRef.current.send(JSON.stringify({ audio: base64data }));
                    };
                }
            };

            // Send chunks every 500ms
            mediaRecorderRef.current.start(500);
            setIsRecording(true);
        } catch (err) {
            console.error('Error accessing microphone', err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
        setIsRecording(false);
    };

    return (
        <div className="app-container">
            <header>
                <h1>Fraud Check 🛡️</h1>
                <p className={`status ${isConnected ? 'online' : 'offline'}`}>
                    {isConnected ? 'Agent Online' : 'Agent Offline'}
                </p>
            </header>

            <main>
                <div className="card controls">
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        style={{ backgroundColor: isRecording ? '#ffebee' : undefined, color: isRecording ? '#c62828' : undefined }}
                    >
                        {isRecording ? <MicOff /> : <Mic />}
                        {isRecording ? ' Stop Listening' : ' Talk to Agent'}
                    </button>
                    <button style={{ marginLeft: '1rem' }} disabled title="Camera support mock">
                        <Camera /> Scan Receipt
                    </button>
                </div>

                <div className="card output">
                    <h3>Agent Logs</h3>
                    <div className="logs">
                        {messages.length === 0 ? <p style={{ color: '#888' }}>Waiting for interaction...</p> : null}
                        {messages.map((msg, i) => (
                            <p key={i}>{msg}</p>
                        ))}
                    </div>

                    {infographic && (
                        <div className="infographic">
                            <h4><Info size={16} /> Legal Infographic</h4>
                            <p>{infographic.topic}</p>
                            <img src={infographic.url} alt="Generated Infographic" style={{ maxWidth: '100%', borderRadius: '8px' }} />
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default App;
