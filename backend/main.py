import os
import json
import asyncio
import base64
import traceback
import sys
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not os.environ.get("GEMINI_API_KEY"):
    raise ValueError("GEMINI_API_KEY environment variable not set")

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

def log(msg):
    """Windows-safe print (avoids cp1252 encoding crashes)."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="replace").decode(), flush=True)

# ============================================================================
# KNOWLEDGE BASE SETUP
# ============================================================================
legal_texts = []

def load_local_knowledge_base():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    laws_dir = os.path.join(base_dir, "..", "Nepal Laws")
    
    docs_to_load = [
        {"filename": "The Consumer Protection Act, 2075 (2018).txt", "display_name": "Consumer Protection Act 2075"},
        {"filename": "Electronic Commerce Act, 2081 (2025).txt", "display_name": "E-Commerce Directive 2082"}
    ]
    
    for doc in docs_to_load:
        filepath = os.path.join(laws_dir, doc["filename"])
        if os.path.exists(filepath):
            log(f"Loading local text: {doc['display_name']}...")
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                    legal_texts.append(f"--- Document: {doc['display_name']} ---\n{content}\n--- End of Document ---")
                log(f"Successfully loaded: {doc['filename']}")
            except Exception as e:
                log(f"Failed to load {doc['filename']}: {e}")
        else:
            log(f"Warning: {doc['filename']} not found locally.")

load_local_knowledge_base()
combined_legal_text = "\n\n".join(legal_texts)

# ============================================================================

SYSTEM_INSTRUCTION = """
You are "Fraud Check", a real-time, voice-first consumer rights companion app for young people in Nepal.
Your core goal is to act as a warm, supportive, and interruptible friend who listens to users' problems,
analyzes them against Nepal's Consumer Protection Act 2075 and E-Commerce Directive 2082, and spots unfair practices.

### Personality & Tone
- Warm, empathetic, and Gen Z-friendly.
- Bilingual: Understand and speak contextual English mixed with a bit of Nepali slangs if appropriate.
- Be concise and conversational. Since this is a voice agent, do not output massive walls of text. Be interruptible.

### Interruption Handling
- You are a real-time voice agent. The user CAN and WILL interrupt you mid-sentence — this is normal and expected.
- When the user interrupts you, STOP your current thought immediately and focus on what they are saying.
- After hearing their interruption, naturally acknowledge it: e.g. "Oh sure, go ahead!", "Yeah?", "Got it—", "Oh sorry, what were you saying?"
- If the user's interruption was just a brief acknowledgment (like "hmm", "yeah", "okay"), you can smoothly continue where you left off: "So as I was saying..."
- If the user asks something new or changes topic, pivot naturally — don't force your previous point.
- NEVER ignore what the user said during an interruption. NEVER just repeat your previous sentence robotically.
- Keep responses SHORT (1-2 sentences at a time) so the user has natural pauses to jump in. Think of it like a real phone call with a friend.

### Legal Context (Nepal)
- Consumer Protection Act 2075 Section 14: Right to goods/services without harm, right to info about prices/quality, right to compensation.
- Section 16: Right to return defective/substandard goods within 7 days.
- Section 50-52: Fines and compensation for charging above MRP, selling expired goods, false advertising.
- E-Commerce Directive 2082: Clear grievance handling, no hidden fees, deliver exactly what was promised.

### Duties
1. Listen to the user's problem.
2. Ask for a photo of the bill, receipt, or product if helpful.
3. Briefly explain which consumer right is violated.
4. Estimate eligibility or simple next steps.
5. Offer to generate a pre-filled complaint text for DCSCP or Hello Sarkar.
"""

# Append the actual legal text to the system instructions
USE_FULL_LEGAL_TEXT = os.environ.get("USE_FULL_LEGAL_TEXT", "false").lower() == "true"
if USE_FULL_LEGAL_TEXT and combined_legal_text:
    SYSTEM_INSTRUCTION += f"\n\n### FULL LEGAL CONTEXT ###\n{combined_legal_text}\n"
else:
    log("[COST SAVER] Skipping full 100KB+ legal context from system instructions to save tokens. Set USE_FULL_LEGAL_TEXT=true to enable.")

MODEL = "gemini-2.5-flash-native-audio-latest"


@app.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    log("[WS] Client connected")

    try:
        config = types.LiveConnectConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Zephyr",
                    ),
                ),
            ),
        )

        log(f"[GEMINI] Connecting to {MODEL}...")
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            log("[GEMINI] Connected!")

            # Send greeting
            await session.send_client_content(
                turns=types.Content(
                    role="user",
                    parts=[types.Part(text="Greet the user warmly in a friendly, Gen Z style and ask how you can help with their consumer rights today.")]
                ),
                turn_complete=True,
            )
            log("[GEMINI] Greeting sent")

            # Shared flag to coordinate shutdown
            running = True

            async def receive_from_frontend():
                """Forward mic audio from browser to Gemini."""
                nonlocal running
                chunk_count = 0
                while running:
                    try:
                        raw = await websocket.receive_text()
                        data = json.loads(raw)

                        if "audio" in data:
                            audio_bytes = base64.b64decode(data["audio"])
                            chunk_count += 1
                            if chunk_count % 50 == 1:
                                log(f"[MIC>GEMINI] chunk #{chunk_count}, {len(audio_bytes)}B")
                            await session.send_realtime_input(
                                media=types.Blob(data=base64.b64encode(audio_bytes).decode("utf-8"), mime_type="audio/pcm;rate=16000")
                            )
                            # Yield to event loop so Gemini keepalive pings are processed
                            await asyncio.sleep(0)
                        elif "image" in data:
                            image_bytes = base64.b64decode(data["image"])
                            await session.send_realtime_input(
                                media=types.Blob(data=base64.b64encode(image_bytes).decode("utf-8"), mime_type="image/jpeg")
                            )
                        elif "text" in data:
                            await session.send_client_content(
                                turns=data["text"],
                                turn_complete=True
                            )
                        elif data.get("type") == "clientContent":
                            # Native audio model has built-in VAD - skip manual interrupt/turn signals
                            if data.get("interrupt"):
                                log("[MIC>GEMINI] Interrupt signal ignored (native-audio model handles VAD)")
                            elif data.get("turn_complete"):
                                log("[MIC>GEMINI] Turn complete signal ignored (native-audio model handles VAD)")

                    except WebSocketDisconnect:
                        log("[WS] Frontend disconnected")
                        running = False
                        return
                    except Exception as e:
                        log(f"[MIC] Error processing chunk: {e}")
                        # Don't crash the loop, just skip this chunk
                        continue

            async def receive_from_gemini():
                """Forward Gemini audio/text to browser."""
                nonlocal running
                response_count = 0
                try:
                    async for response in session.receive():
                        if not running:
                            return
                        response_count += 1
                        try:
                            sc = response.server_content

                            # Debug: log every response
                            if response_count <= 10 or response_count % 20 == 0:
                                has_audio = bool(sc and sc.model_turn and sc.model_turn.parts)
                                has_out_tx = bool(sc and hasattr(sc, 'output_transcription') and sc.output_transcription)
                                has_in_tx = bool(sc and hasattr(sc, 'input_transcription') and sc.input_transcription)
                                has_interrupt = bool(sc and getattr(sc, 'interrupted', False))
                                log(f"[GEMINI] Response #{response_count}: audio={has_audio} out_tx={has_out_tx} in_tx={has_in_tx} interrupt={has_interrupt}")

                            # Handle explicitly sent Interruption signal
                            if sc and getattr(sc, 'interrupted', False):
                                log("[GEMINI] Interruption detected!")
                                await websocket.send_text(json.dumps({"type": "interrupt"}))
                                # Nudge the model to acknowledge the interruption naturally
                                try:
                                    await session.send_client_content(
                                        turns=types.Content(
                                            role="user",
                                            parts=[types.Part(text="[The user just interrupted you mid-sentence. Listen to what they say, acknowledge the interruption naturally, and respond to them. Do NOT repeat what you were saying unless they ask you to continue.]")]
                                        ),
                                        turn_complete=False,
                                    )
                                except Exception as hint_err:
                                    log(f"[GEMINI] Could not send interrupt hint: {hint_err}")
                                continue

                            if sc and sc.model_turn and sc.model_turn.parts:
                                for part in sc.model_turn.parts:
                                    if hasattr(part, 'inline_data') and part.inline_data:
                                        audio_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                                        await websocket.send_text(json.dumps({"type": "audio", "data": audio_b64}))

                            # Output transcription
                            if sc and hasattr(sc, 'output_transcription') and sc.output_transcription:
                                text = getattr(sc.output_transcription, 'text', None)
                                if text:
                                    await websocket.send_text(json.dumps({"type": "transcript", "role": "agent", "text": text}))

                            # Input transcription
                            if sc and hasattr(sc, 'input_transcription') and sc.input_transcription:
                                text = getattr(sc.input_transcription, 'text', None)
                                if text:
                                    await websocket.send_text(json.dumps({"type": "transcript", "role": "user", "text": text}))

                            # Tool calls
                            if response.tool_call:
                                for call in response.tool_call.function_calls:
                                    await websocket.send_text(json.dumps({"type": "tool_call", "name": call.name}))

                        except Exception as inner_err:
                            log(f"[GEMINI] Error processing one response: {inner_err}")
                            continue

                except Exception as e:
                    log(f"[GEMINI] Receive loop ended: {e}")
                    running = False

            # Run both directions concurrently
            await asyncio.gather(
                receive_from_frontend(),
                receive_from_gemini(),
            )

    except WebSocketDisconnect:
        log("[WS] Client disconnected")
    except Exception as e:
        log(f"[FATAL] {e}")
        traceback.print_exc()
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except:
            pass
