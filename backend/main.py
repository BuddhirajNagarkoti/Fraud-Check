import os
import json
import base64
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load .env from the backend/ directory regardless of where uvicorn is invoked from
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(_BASE_DIR, ".env"))

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

# The Gemini Live API (bidiGenerateContent) is only available on v1alpha.
# The upgraded SDK defaults to v1beta, so we pin the version here.
client = genai.Client(http_options={"api_version": "v1alpha"})

# ============================================================================
# KNOWLEDGE BASE SETUP WITH URI CACHING
# ============================================================================
# PDFs are uploaded to Gemini File API once and the URIs are cached to a JSON
# file so we skip re-uploading on every restart. Gemini file URIs expire after
# 48 hours, so we verify the URI is still alive before using it.

_CACHE_FILE = os.path.join(_BASE_DIR, "pdf_uri_cache.json")

uploaded_legal_docs = []


def _load_cache() -> dict:
    if os.path.exists(_CACHE_FILE):
        with open(_CACHE_FILE) as f:
            return json.load(f)
    return {}


def _save_cache(cache: dict) -> None:
    with open(_CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def _is_file_valid(uri: str) -> bool:
    """Return True if the file URI still exists in Gemini File API."""
    try:
        for f in client.files.list():
            if f.uri == uri:
                return True
        return False
    except Exception:
        return False


def initialize_knowledge_base() -> None:
    laws_dir = os.path.join(_BASE_DIR, "..", "Nepal Laws")
    docs = [
        {
            "path": os.path.join(laws_dir, "The Consumer Protection Act, 2075 (2018).pdf"),
            "display_name": "Consumer Protection Act 2075",
            "key": "consumer_protection_act",
        },
        {
            "path": os.path.join(laws_dir, "Electronic Commerce Act, 2081 (2025).pdf"),
            "display_name": "E-Commerce Directive 2082",
            "key": "ecommerce_directive",
        },
    ]

    cache = _load_cache()
    cache_updated = False

    for doc in docs:
        key = doc["key"]

        # Reuse cached URI if still valid
        if key in cache and _is_file_valid(cache[key]):
            print(f"Using cached URI for {doc['display_name']}: {cache[key]}")

            class _CachedFile:
                def __init__(self, uri: str):
                    self.uri = uri

            uploaded_legal_docs.append(_CachedFile(cache[key]))
            continue

        if not os.path.exists(doc["path"]):
            print(f"PDF not found, skipping: {doc['path']}")
            continue

        print(f"Uploading {doc['display_name']}...")
        try:
            uploaded = client.files.upload(
                file=doc["path"],
                config={"display_name": doc["display_name"]},
            )
            uploaded_legal_docs.append(uploaded)
            cache[key] = uploaded.uri
            cache_updated = True
            print(f"Uploaded and cached: {uploaded.uri}")
        except Exception as e:
            print(f"Upload failed for {doc['path']}: {e}")

    if cache_updated:
        _save_cache(cache)


initialize_knowledge_base()

# ============================================================================
# SYSTEM INSTRUCTION
# ============================================================================

SYSTEM_INSTRUCTION = """
You are "Fraud Check", a real-time, voice-first consumer rights companion for young people in Nepal.
Your goal is to act as a warm, supportive, interruptible friend who listens to problems,
analyzes them against Nepal's Consumer Protection Act 2075 and E-Commerce Directive 2082, and spots unfair practices.

### Personality & Tone
- Warm, empathetic, Gen Z-friendly. Be supportive, a little sassy against bad actors, use emojis freely.
- Bilingual: Understand and respond in English or Nepali, or a natural mix. Keep it clear.
- Be concise and conversational — this is a voice agent, avoid long walls of text. Stay interruptible.

### Legal Context (Nepal)
- Consumer Protection Act 2075 Section 14: Right to safe goods/services, right to price/quality info, right to compensation for unfair trade.
- Section 16: Right to return defective/substandard/misdescribed goods within 7 days.
- Section 50–52: Fines for selling above MRP, expired goods, or false advertising.
- E-Commerce Directive 2082: Platforms must have grievance handling mechanisms, no hidden fees, must deliver exactly what was advertised.

### Your Duties
1. Listen carefully to the user's problem.
2. Ask for a photo of the receipt, bill, or product if it would help (you process multimodal input).
3. Briefly explain which consumer right is being violated.
4. Estimate eligibility and suggest simple next steps.
5. Offer to generate a pre-filled complaint text for DCSCP or Hello Sarkar (call generate_complaint_draft).
6. If the user wants a visual explainer about their rights, call show_infographic.
"""

MODEL = "gemini-2.5-flash-native-audio-latest"

# ============================================================================
# TOOL DEFINITIONS — using FunctionDeclaration dicts for max SDK compatibility
# ============================================================================

TOOL_DECLARATIONS = [
    types.FunctionDeclaration(
        name="generate_complaint_draft",
        description=(
            "Pre-fills a formal complaint text for filing with DCSCP or Hello Sarkar "
            "based on the consumer's issue. Call this when the user wants to file a complaint."
        ),
        parameters={
            "type": "object",
            "properties": {
                "issue_summary": {
                    "type": "string",
                    "description": "A clear, detailed summary of the consumer issue",
                },
                "company_name": {
                    "type": "string",
                    "description": "Name of the company or business involved",
                },
                "consumer_name": {
                    "type": "string",
                    "description": "Name of the consumer filing the complaint",
                },
            },
            "required": ["issue_summary", "company_name", "consumer_name"],
        },
    ),
    types.FunctionDeclaration(
        name="show_infographic",
        description=(
            "Signals the frontend to display a visual explainer card about a consumer rights topic. "
            "Call this when explaining legal concepts visually would help the user."
        ),
        parameters={
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The consumer rights topic to visualize (e.g. 'return policy', 'price fraud', 'refund rights')",
                },
            },
            "required": ["topic"],
        },
    ),
]


def _exec_generate_complaint_draft(args: dict) -> str:
    issue_summary = args.get("issue_summary", "Consumer issue not specified")
    company_name = args.get("company_name", "Unknown Company")
    consumer_name = args.get("consumer_name", "Consumer")
    return (
        "COMPLAINT TO DCSCP / HELLO SARKAR\n\n"
        f"I, {consumer_name}, wish to file a formal complaint against {company_name}.\n\n"
        f"Issue Details:\n{issue_summary}\n\n"
        "Requested Resolution: Investigation and appropriate compensation as per "
        "Nepal Consumer Protection Act 2075."
    )


def _exec_show_infographic(args: dict) -> dict:
    topic = args.get("topic", "consumer rights")
    return {"action": "render_infographic", "topic": topic}


def execute_tool(name: str, args: dict):
    if name == "generate_complaint_draft":
        return _exec_generate_complaint_draft(args)
    if name == "show_infographic":
        return _exec_show_infographic(args)
    return None


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================

@app.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        # Build system instruction — native audio models only accept text parts here.
        # The key legal provisions are already embedded in SYSTEM_INSTRUCTION text.
        config = types.LiveConnectConfig(
            system_instruction=types.Content(
                parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)]
            ),
            tools=[types.Tool(function_declarations=TOOL_DECLARATIONS)],
            response_modalities=["AUDIO"],
        )

        async with client.aio.live.connect(model=MODEL, config=config) as session:
            print("Gemini Live session started")

            async def receive_from_frontend():
                try:
                    while True:
                        message = await websocket.receive_text()
                        data = json.loads(message)

                        if "audio" in data:
                            # Frontend sends raw PCM Int16 at 16kHz as base64
                            await session.send(
                                input={"mime_type": "audio/pcm;rate=16000", "data": data["audio"]}
                            )
                        elif "image" in data:
                            # JPEG frame from receipt camera as base64
                            await session.send(
                                input={"mime_type": "image/jpeg", "data": data["image"]}
                            )
                        elif "text" in data:
                            await session.send(input={"text": data["text"]})
                except WebSocketDisconnect:
                    print("Frontend disconnected")

            async def receive_from_gemini():
                try:
                    async for response in session.receive():
                        # --- Audio / text model turn ---
                        if response.server_content and response.server_content.model_turn:
                            for part in response.server_content.model_turn.parts:
                                if part.inline_data:
                                    # Gemini outputs raw PCM bytes — base64-encode for JSON
                                    raw = part.inline_data.data
                                    audio_b64 = (
                                        base64.b64encode(raw).decode("utf-8")
                                        if isinstance(raw, bytes)
                                        else raw
                                    )
                                    await websocket.send_text(
                                        json.dumps({"type": "audio", "data": audio_b64})
                                    )
                                elif part.text:
                                    # Forward text transcript to frontend for display
                                    await websocket.send_text(
                                        json.dumps({"type": "text", "data": part.text})
                                    )

                        # --- Tool calls ---
                        if response.tool_call:
                            for call in response.tool_call.function_calls:
                                call_name = call.name
                                call_args = dict(call.args) if call.args else {}

                                # 1. Notify frontend a tool is running
                                await websocket.send_text(
                                    json.dumps({"type": "tool_call", "name": call_name})
                                )

                                # 2. Execute the tool locally
                                result = execute_tool(call_name, call_args)

                                # 3. Push specific results to frontend UI
                                if call_name == "generate_complaint_draft" and result:
                                    await websocket.send_text(
                                        json.dumps({"type": "complaint_draft", "data": result})
                                    )
                                elif call_name == "show_infographic" and result:
                                    await websocket.send_text(
                                        json.dumps(
                                            {"type": "infographic", "topic": result.get("topic", "")}
                                        )
                                    )

                                # 4. Send tool result back to Gemini so it can continue
                                tool_response = types.LiveClientToolResponse(
                                    function_responses=[
                                        types.FunctionResponse(
                                            id=call.id,
                                            name=call_name,
                                            response={
                                                "result": (
                                                    str(result) if result is not None else "done"
                                                )
                                            },
                                        )
                                    ]
                                )
                                await session.send(input=tool_response)

                except Exception as e:
                    print(f"Gemini receive error: {e}")
                    try:
                        await websocket.send_text(
                            json.dumps({"type": "error", "data": str(e)})
                        )
                    except Exception:
                        pass

            await asyncio.gather(receive_from_frontend(), receive_from_gemini())

    except WebSocketDisconnect:
        print("Client disconnected before session started")
    except Exception as e:
        print(f"Session error: {e}")
        try:
            await websocket.send_json({"type": "error", "data": str(e)})
        except Exception:
            pass
