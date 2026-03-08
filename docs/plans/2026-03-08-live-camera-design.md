# Live Camera Feature Design

## Overview
Add a "Live Session" mode where the user's camera and microphone stream together. The camera shows a live preview, and tapping the feed captures a frame, sends it to Gemini for analysis, and saves it as evidence — all while voice conversation continues naturally.

## Architecture
No new APIs needed. The existing Gemini Live session already accepts images via `sendRealtimeInput`. Camera frames follow the same WebSocket -> backend -> Gemini path as current photo uploads.

## UI Layout
- **Desktop (768px+):** Split view — camera on one side, orb + transcript on the other
- **Mobile (<768px):** Toggle between Camera view and Orb/Transcript view (add "Camera" as a new tab alongside "Live" and "Transcript")

## New Controls
- **"Live Session" toggle button** — Starts both camera + mic together, stops both together. Replaces the current standalone mic toggle when active.
- Existing "Upload Evidence" and "Take Photo" buttons remain untouched.

## Camera Interaction
- Live `<video>` preview from `getUserMedia({ video: true, audio: true })`
- **Tap anywhere on the camera feed** to capture current frame via canvas
- **Ripple animation** expands from tap point as visual feedback
- Captured frame is:
  1. Sent to Gemini via WebSocket as `{ image: base64, mimeType: 'image/jpeg' }`
  2. Displayed in the transcript as an evidence thumbnail
  3. Auto-saved to `localStorage` as `fraud-check-evidence`
  4. Available for email attachment

## Agent Response
- Gemini responds via voice about what it sees
- Captured frame + AI analysis text appear together in transcript
- Violation detection continues working on the AI's spoken response

## Session Lifecycle
1. User taps "Live Session" -> camera + mic start -> orb switches to active state
2. User talks + shows things -> continuous audio stream, tap-to-capture images
3. User taps "Live Session" again -> camera + mic stop -> back to idle orb
4. All captured evidence persists in transcript and localStorage

## What stays the same
- Orb animations, violation detection, email drafting, onboarding, existing upload buttons — all unchanged
- Backend changes are minimal (no new endpoints or session config needed)
