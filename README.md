# Fraud Check

**A real-time, voice-first consumer rights companion for Nepal — powered by Google's Gemini Live API.**

Fraud Check is a Progressive Web App that acts as a warm, supportive friend for young consumers in Nepal. Users speak naturally about their problems — e-commerce fraud, overcharging, defective products, misleading ads — and the AI agent listens, identifies legal violations in real-time, and guides them through actionable next steps grounded in Nepali law.

---

## The Problem

Young consumers in Nepal frequently face fraud — overpriced goods, expired products, undelivered online orders, false advertising — but most don't know their legal rights or how to take action. Filing formal complaints feels intimidating, and legal language is inaccessible.

## The Solution

Fraud Check makes consumer protection accessible through **conversation**. Instead of reading legal documents, users just talk. The app:

1. **Listens** to the user's problem via real-time voice streaming
2. **Analyzes** the situation against Nepal's consumer protection laws
3. **Shows** which legal sections are violated (with actionable cards)
4. **Advises** practical steps the user can take (contact seller, keep evidence, call Hello Sarkar 1111, visit DCSCP)
5. **Drafts and sends** formal complaint emails to authorities — only when the user asks for it

---

## Key Features

### Voice-First Interaction
Real-time, low-latency voice conversation using **Gemini 2.5 Flash Native Audio** via the **Gemini Live API**. Users speak naturally; the agent responds conversationally with the Zephyr voice.

### Natural Interruption Handling
Users can speak over the agent mid-sentence — just like a real phone call. The agent acknowledges the interruption naturally ("Oh sure, go ahead!", "Yeah?") and either pivots to the user's new topic or smoothly continues where it left off. Powered by Gemini's built-in VAD with contextual interrupt hints.

### Quick Scenario Buttons
First-time users see pre-built scenario pills — "Overcharged for a product", "Defective item received", "Online order not delivered", "Fake or misleading ad" — that instantly start a conversation with context and auto-activate the microphone.

### Multimodal Evidence Analysis
Users upload photos or take live camera shots of defective products, expired goods, or receipts. Gemini analyzes the image and cross-references it with the user's verbal claim to verify the issue.

### Real-Time Violation Detection
As the agent speaks, the app parses the transcript for legal section references and instantly displays **violation cards** in the transcript and **animated violation chips** on the Live tab with:
- The exact law and section number
- A plain-language explanation of the violation
- Recommended next steps

### Consumer Advisory
Before offering to draft emails, the agent first advises practical steps:
- Contact the seller directly and demand resolution
- Keep receipts, screenshots, and evidence safe
- Call Hello Sarkar (1111) for government assistance
- File a complaint at the local DCSCP office
- Know deadlines (e.g., 7-day return window under Section 16)

### Email Complaint Drafting & Sending
When the user is ready, the agent drafts a formal complaint email. The app:
- Parses the draft from the agent's speech
- Displays it for review
- Sends it via **Gmail API** with evidence photos attached
- Requires Google sign-in only at this step

### Session Persistence
Transcripts, violations, and evidence persist across page refreshes via localStorage. A "New Session" button in the top bar lets users start fresh at any time.

### Onboarding
First-time visitors see a clean 3-step overlay — "Tell us your problem", "We'll find the law", "Take action" — that introduces the app flow before dismissing permanently.

### Progressive Web App
Installable on mobile and desktop. Works in standalone mode with proper app icons and manifest.

### Light & Dark Mode
Theme toggle with system preference detection and localStorage persistence.

### Responsive Layout
- **Mobile**: Tab-based interface (Live / Transcript)
- **Desktop**: Side-by-side 2-panel layout (voice orb + live transcript)

---

## Gemini API Integration

| Feature | How It's Used |
|---------|---------------|
| **Gemini Live API** | Real-time bidirectional audio streaming via WebSocket — the core of the app |
| **Native Audio Model** | `gemini-2.5-flash-native-audio-latest` for low-latency voice input/output |
| **Multimodal Input** | Voice + image analysis (product photos, receipts) in the same session |
| **Output Audio Transcription** | Parsed in real-time to detect legal violations and email drafts |
| **Input Audio Transcription** | Displayed as user's speech in the transcript |
| **Prebuilt Voice (Zephyr)** | Natural, Gen-Z-friendly voice for the agent persona |
| **System Instruction** | Embeds Nepal's Consumer Protection Act 2075 and E-Commerce Directive 2082 as legal context |
| **Interruption Handling** | Users can speak over the agent; audio stops, context hint injected so agent acknowledges naturally |

---

## Architecture

```
Browser (React PWA)
├── Web Audio API + AudioWorklet (16kHz PCM capture)
├── WebSocket client (real-time audio/image streaming)
├── Google OAuth (Gmail send scope)
└── UI: Voice orb, transcript, violation cards, email drafts
        │
        │ WebSocket (ws:// / wss://)
        ▼
Python Backend (FastAPI + WebSocket)
├── Gemini Live API session (per client)
├── Transcript-based violation detection (regex)
├── Email draft parsing from agent speech
├── Gmail API (send complaints with attachments)
└── Static file serving (frontend dist)
        │
        │ Gemini Live API + Gmail API
        ▼
Google Cloud APIs
├── Gemini 2.5 Flash Native Audio (voice + vision)
└── Gmail API (send on behalf of user)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Web Audio API, AudioWorklet |
| Backend | Python, FastAPI, WebSocket, google-genai SDK |
| AI | Google Gemini Live API (gemini-2.5-flash-native-audio) |
| Email | Google Gmail API with OAuth 2.0 |
| PWA | vite-plugin-pwa, Workbox |
| Deployment | Docker, Google Cloud Run |

---

## Local Development

### Prerequisites
- Python 3.10+
- Node.js 18+
- Google Gemini API Key
- Google OAuth Client ID (for Gmail integration)

### Setup

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env  # Add your GEMINI_API_KEY
uvicorn main:app --port 8002

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173` with the backend on port `8002`.

### Environment Variables

**Backend (`backend/.env`)**
```
GEMINI_API_KEY=your-gemini-api-key
PORT=8002
```

**Frontend (`frontend/.env`)**
```
VITE_BACKEND_PORT=8002
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
```

---

## Deployment (Google Cloud Run)

The app deploys as a single container — the backend serves the frontend build.

1. Push to GitHub → Cloud Build triggers automatically
2. Multi-stage Dockerfile builds frontend, bundles with backend
3. Cloud Run serves everything on port 8080

### Cloud Run Configuration
- **Request timeout**: 3600s (for long voice sessions)
- **Session affinity**: Enabled (WebSocket sticky sessions)
- **Environment variable**: `GEMINI_API_KEY`
- **Build arg**: `VITE_GOOGLE_CLIENT_ID`

---

## Legal Context

The app is grounded in two key Nepali laws:

- **Consumer Protection Act 2075 (2018)**
  - Section 14: Right to safe goods, price info, quality info, compensation
  - Section 16: Right to return defective goods within 7 days
  - Sections 50-52: Penalties for overcharging, expired goods, false advertising

- **E-Commerce Directive 2082 (2025)**
  - Clear grievance handling requirements
  - No hidden fees
  - Deliver exactly what was promised

---

## Team

Built for the **Google Gemini API Developer Competition** by Buddhiraj Nagarkoti.
