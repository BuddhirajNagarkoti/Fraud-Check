# Live Camera Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Live Session" mode that streams camera + mic together, with tap-to-capture frames sent to Gemini for analysis and saved as evidence.

**Architecture:** No new APIs or backend endpoints needed. The existing WebSocket + `sendRealtimeInput` path already accepts images. All changes are frontend-only: new camera state, `<video>` preview, canvas frame capture, ripple animation, and layout adjustments for split/tab views.

**Tech Stack:** React 18, Web APIs (getUserMedia, Canvas), existing WebSocket transport, CSS animations

---

### Task 1: Add Live Session State and Camera Refs

**Files:**
- Modify: `frontend/src/App.jsx:1-68` (imports + state declarations + refs)

**Step 1: Add new imports**

Add `Video` to the lucide-react imports (line 2):
```jsx
import { Mic, MicOff, Volume2, AlertTriangle, ArrowRight, MessageSquareText, Radio, Camera, Send, Mail, CheckCircle, Image, WifiOff, X, Sun, Moon, Scale, Zap, RotateCcw, ChevronDown, ChevronUp, Clock, Video } from 'lucide-react';
```

**Step 2: Add live session state variables**

After line 27 (`subtitleVisible` state), add:
```jsx
const [isLiveSession, setIsLiveSession] = useState(false);
const [isCameraReady, setIsCameraReady] = useState(false);
```

**Step 3: Add camera refs**

After line 67 (`cameraInputRef`), add:
```jsx
const videoRef = useRef(null);
const canvasRef = useRef(null);
const cameraStreamRef = useRef(null);
```

**Step 4: Commit**
```bash
git add frontend/src/App.jsx
git commit -m "feat: add live session state and camera refs"
```

---

### Task 2: Implement Start/Stop Live Session Functions

**Files:**
- Modify: `frontend/src/App.jsx:275-335` (after existing mic functions)

**Step 1: Create startLiveSession function**

After the `stopRecording` function (line 335), add:
```jsx
const startLiveSession = async () => {
    try {
        // Initialize playback context
        if (!playbackCtxRef.current) {
            const pCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
            playbackCtxRef.current = pCtx;
        }
        if (playbackCtxRef.current.state === 'suspended') {
            await playbackCtxRef.current.resume();
        }

        // Get both video and audio
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
        });

        // Set video preview
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
        }
        cameraStreamRef.current = stream;
        setIsCameraReady(true);

        // Set up audio processing (same as startRecording)
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
```

**Step 2: Update handleNewSession to stop live session**

In `handleNewSession` (line 132-142), change `if (isRecording) stopRecording();` to:
```jsx
if (isLiveSession) stopLiveSession();
else if (isRecording) stopRecording();
```

**Step 3: Update auto-restart after agent finishes speaking**

In the useEffect for auto-restart (lines 338-343), update to handle live session:
```jsx
useEffect(() => {
    if (prevAgentSpeakingRef.current && !agentSpeaking && !isRecording && !isLiveSession) {
        startRecording();
    }
    prevAgentSpeakingRef.current = agentSpeaking;
}, [agentSpeaking]);
```

**Step 4: Commit**
```bash
git add frontend/src/App.jsx
git commit -m "feat: implement start/stop live session with camera + mic"
```

---

### Task 3: Implement Tap-to-Capture with Ripple Animation

**Files:**
- Modify: `frontend/src/App.jsx` (add capture function + camera preview component)

**Step 1: Add captureFrame function**

After `toggleLiveSession`, add:
```jsx
const captureFrame = (e) => {
    if (!videoRef.current || !isCameraReady) return;

    // Ripple animation at tap point
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ripple = document.createElement('div');
    ripple.className = 'camera-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    e.currentTarget.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);

    // Capture frame from video
    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    // Send to Gemini
    sendMessage(JSON.stringify({ image: base64, mimeType: 'image/jpeg' }));
    sendMessage(JSON.stringify({
        text: 'I just captured a frame from my live camera. Please analyze this image and tell me what you see — does it support my complaint?'
    }));

    // Save as evidence
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    setLastEvidence({ name: `capture-${timestamp}.jpg`, type: 'image/jpeg', base64 });

    // Add to transcript with preview
    setTranscripts(prev => [...prev, {
        role: 'user',
        text: '\u{1F4F8} Live Capture',
        id: Date.now(),
        evidencePreview: `data:image/jpeg;base64,${base64}`
    }]);

    showToast('Frame captured & sent for analysis', 'success', 2000);
};
```

**Step 2: Add renderCameraArea component function**

After `renderOrbArea`, add:
```jsx
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
```

**Step 3: Commit**
```bash
git add frontend/src/App.jsx
git commit -m "feat: add tap-to-capture with ripple animation and evidence saving"
```

---

### Task 4: Update Layout — Desktop Split View + Mobile Tab

**Files:**
- Modify: `frontend/src/App.jsx:445-685` (renderOrbArea, desktop panels, mobile tabs)

**Step 1: Add "Live Session" button to renderOrbArea**

In `renderOrbArea`, after the evidence-buttons div (line 486), add a Live Session button:
```jsx
<button
    className={`live-session-btn ${!isConnected ? 'disabled' : ''}`}
    onClick={toggleLiveSession}
    disabled={!isConnected}
>
    <Video size={16} /> Live Session
</button>
```

**Step 2: Update desktop layout for split view**

Replace the desktop panels section (lines 650-671) with:
```jsx
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
```

**Step 3: Update mobile tab bar**

Replace the tab-bar div (lines 635-647) with:
```jsx
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
```

**Step 4: Auto-switch to camera tab on mobile when live session starts**

Add a useEffect after the existing tab-related logic:
```jsx
useEffect(() => {
    if (isLiveSession && !isDesktop) {
        setActiveTab('camera');
    } else if (!isLiveSession && activeTab === 'camera') {
        setActiveTab('live');
    }
}, [isLiveSession, isDesktop]);
```

**Step 5: Commit**
```bash
git add frontend/src/App.jsx
git commit -m "feat: update layout with camera split view (desktop) and camera tab (mobile)"
```

---

### Task 5: Add CSS for Camera Feed, Ripple, and Live Session Button

**Files:**
- Modify: `frontend/src/index.css` (append new styles)

**Step 1: Add camera area styles**

Append to the end of `index.css`:
```css
/* ============ Live Camera ============ */
.camera-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    height: 100%;
    justify-content: center;
}

.camera-feed-container {
    position: relative;
    width: 100%;
    max-width: 560px;
    aspect-ratio: 16 / 9;
    border-radius: 16px;
    overflow: hidden;
    background: var(--surface);
    cursor: pointer;
    border: 2px solid var(--border);
    transition: border-color 0.3s;
}

.camera-feed-container:hover {
    border-color: var(--accent);
}

.camera-feed {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.camera-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--text-secondary);
}

.camera-tap-hint {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    pointer-events: none;
    opacity: 0.8;
    transition: opacity 0.3s;
}

.camera-feed-container:hover .camera-tap-hint {
    opacity: 1;
}

.camera-controls {
    display: flex;
    gap: 0.75rem;
}

/* Ripple effect on tap */
.camera-ripple {
    position: absolute;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    transform: translate(-50%, -50%);
    animation: camera-ripple-expand 0.6s ease-out forwards;
    pointer-events: none;
    z-index: 10;
}

@keyframes camera-ripple-expand {
    0% {
        width: 0;
        height: 0;
        opacity: 1;
    }
    100% {
        width: 300px;
        height: 300px;
        opacity: 0;
    }
}

/* Live Session button */
.live-session-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.2rem;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 0.5rem;
}

.live-session-btn:hover:not(.disabled) {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
}

.live-session-btn.active {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
}

.live-session-btn.active:hover {
    background: rgba(239, 68, 68, 0.25);
}

.live-session-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
```

**Step 2: Commit**
```bash
git add frontend/src/index.css
git commit -m "feat: add CSS for camera feed, ripple animation, and live session button"
```

---

### Task 6: Handle Edge Cases and Cleanup

**Files:**
- Modify: `frontend/src/App.jsx`

**Step 1: Stop live session on WebSocket disconnect**

In the `onClose` handler (lines 90-98), add live session cleanup:
```jsx
onClose: () => {
    if (wasConnectedRef.current) {
        showToast('Connection lost. Reconnecting...', 'error');
        if (isLiveSession) {
            stopLiveSession();
        } else if (micCleanupRef.current) {
            micCleanupRef.current();
            micCleanupRef.current = null;
            setIsRecording(false);
        }
    }
},
```

**Step 2: Disable orb toggle when live session is active**

In `toggleRecording` (line 405), add guard at the top:
```jsx
const toggleRecording = () => {
    if (isLiveSession) return; // Controlled by live session toggle instead
    // ... rest of existing code
};
```

**Step 3: Clean up camera stream on component unmount**

Add a cleanup useEffect after the existing cleanup effects:
```jsx
useEffect(() => {
    return () => {
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(t => t.stop());
        }
    };
}, []);
```

**Step 4: Commit**
```bash
git add frontend/src/App.jsx
git commit -m "feat: handle edge cases — disconnect cleanup, unmount, orb guard"
```

---

### Task 7: Test End-to-End and Final Polish

**Step 1: Run dev server**
```bash
cd frontend && npm run dev
```

**Step 2: Manual test checklist**
- [ ] "Live Session" button appears below Upload Evidence / Take Photo
- [ ] Clicking "Live Session" opens camera + starts mic recording
- [ ] Camera feed shows in split view (desktop) or camera tab (mobile)
- [ ] Tapping camera feed shows ripple animation at tap point
- [ ] Captured frame appears in transcript with thumbnail
- [ ] Gemini responds via voice about the captured image
- [ ] Evidence is saved (check localStorage `fraud-check-evidence`)
- [ ] "End Live Session" stops camera + mic
- [ ] Orb reappears after ending live session
- [ ] Existing Upload Evidence / Take Photo still work
- [ ] New Session clears everything including live session
- [ ] WebSocket disconnect stops live session gracefully

**Step 3: Final commit**
```bash
git add -A
git commit -m "feat: live camera session — tap-to-capture with Gemini analysis"
```
