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
4. **Advises** practical steps the user can take
5. **Drafts and sends** formal complaint emails to authorities

---

## Key Features

### Voice-First Interaction
Real-time, low-latency voice conversation using **Gemini 2.5 Flash Native Audio** via the **Gemini Live API**. Users speak naturally; the agent responds conversationally with the Zephyr voice.

### Natural Interruption Handling
Users can speak over the agent mid-sentence — just like a real phone call. The agent acknowledges the interruption naturally and either pivots to the user's new topic or smoothly continues where it left off. Powered by Gemini's built-in VAD with contextual interrupt hints.

### Quick Scenario Buttons
Pre-built scenario cards with icons — "Overcharged for a product", "Defective item received", "Online order not delivered", "Fake or misleading ad" — that instantly start a conversation with context and auto-activate the microphone.

### Gradient Mesh Orb
The central voice orb features a rotating conic-gradient mesh that shifts colors per state — warm reds when listening, cool blues when speaking, subtle breathing when idle — with a soft pulsing glow layer for depth.

### Multimodal Evidence Analysis
Users upload photos or take live camera shots of defective products, expired goods, or receipts. Gemini analyzes the image and cross-references it with the user's verbal claim. Evidence thumbnails appear inline in the transcript.

### Real-Time Violation Detection
As the agent speaks, the app parses the transcript for legal section references and instantly displays **collapsible violation cards** in the transcript and **animated violation chips** on the Live tab — showing the exact law, section number, plain-language explanation, and recommended next steps.

### Email Complaint Drafting & Sending
When the user is ready, the agent drafts a formal complaint email. The app displays it for review and sends it via **Gmail API** with evidence photos attached.

### Session Persistence
Transcripts, violations, and evidence persist across page refreshes. A "New Session" button clears everything and starts fresh.

### Onboarding
First-time visitors see a polished 3-step overlay with numbered steps — "Tell us your problem", "We'll find the law", "Take action" — with staggered entrance animations.

### Additional Polish
- **Typing indicator** — animated dots while the agent is speaking
- **Session summary** — elapsed time, violation count, evidence status (desktop)
- **Timestamps** on every transcript bubble
- **Glass morphism top bar** with backdrop blur
- **Light & Dark mode** with system preference detection
- **Responsive layout** — tab-based on mobile, side-by-side panels on desktop
- **Installable PWA** with offline-ready service worker

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
| **Interruption Handling** | Context hint injected on interrupt so agent acknowledges naturally |
| **Deferred Connection** | Gemini session opens only on user interaction — zero idle cost |

---

## Architecture

```
Browser (React PWA)
├── Web Audio API + AudioWorklet (16kHz PCM capture)
├── Deferred WebSocket (connects only on user action)
├── Google OAuth (Gmail send scope)
└── UI: Gradient mesh orb, transcript, violation cards, email drafts
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
| Frontend | React 18, Vite 7, Web Audio API, AudioWorklet |
| Backend | Python, FastAPI, WebSocket, google-genai SDK |
| AI | Google Gemini Live API (gemini-2.5-flash-native-audio) |
| Email | Google Gmail API with OAuth 2.0 |
| PWA | vite-plugin-pwa, Workbox |
| Deployment | Docker, Google Cloud Run |

---

## Legal Context

The app is grounded in two key Nepali laws:

- **Consumer Protection Act 2075 (2018)** — Right to safe goods, price transparency, compensation, 7-day return window for defective goods, penalties for overcharging and false advertising

- **E-Commerce Directive 2082 (2025)** — Clear grievance handling, no hidden fees, deliver exactly what was promised

---

## Team

Built for the **Gemini Live Agent Challenge** by Buddhiraj Nagarkoti.
