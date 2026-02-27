import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Verify API key
if not os.environ.get("GEMINI_API_KEY"):
    raise ValueError("GEMINI_API_KEY environment variable not set")

client = genai.Client()

# ============================================================================
# KNOWLEDGE BASE SETUP (PDF Documents)
# ============================================================================
# Uploading actual legal PDFs to the Gemini API so the model
# can reference the exact text. In production, you would upload these once 
# via a script and save their `uri` to your database, rather 
# than uploading on every server startup.

uploaded_legal_docs = []

def initialize_knowledge_base():
    """Uploads PDFs from the 'Nepal Laws' directory to Gemini File API."""
    # Build complete paths so we can run uvicorn from anywhere
    base_dir = os.path.dirname(os.path.abspath(__file__))
    laws_dir = os.path.join(base_dir, "..", "Nepal Laws")
    
    docs_to_upload = [
        {"path": os.path.join(laws_dir, "The Consumer Protection Act, 2075 (2018).pdf"), "display_name": "Consumer Protection Act 2075"},
        {"path": os.path.join(laws_dir, "Electronic Commerce Act, 2081 (2025).pdf"), "display_name": "E-Commerce Directive 2082"}
    ]
    
    for doc in docs_to_upload:
        if os.path.exists(doc["path"]):
            print(f"Uploading {doc['display_name']}...")
            try:
                # Upload the file to Gemini
                uploaded_file = client.files.upload(
                    file=doc["path"],
                    config={'display_name': doc['display_name']}
                )
                uploaded_legal_docs.append(uploaded_file)
                print(f"Successfully uploaded: {uploaded_file.uri}")
            except Exception as e:
                print(f"Failed to upload {doc['path']}: {e}")
        else:
            print(f"Note: {doc['path']} not found locally. Add the PDF file to test Document Grounding.")

# Run setup (this is a blocking operation usually on startup)
initialize_knowledge_base()
# ============================================================================

# System Instruction with the Consumer Protection context
SYSTEM_INSTRUCTION = """
You are "Fraud Check", a real-time, voice-first consumer rights companion app for young people in Nepal.
Your core goal is to act as a warm, supportive, and interruptible friend who listens to users' problems, 
analyzes them against Nepal's Consumer Protection Act 2075 and E-Commerce Directive 2082, and spots unfair practices.

### Personality & Tone
- Warm, empathetic, and Gen Z-friendly. Feel free to be supportive, sassy when appropriate (e.g., against bad actors), and use emojis in your thought process or output if available.
- Bilingual: Understand and speak contextual English mixed with a bit of Nepali slangs if appropriate, but keep it clear.
- Be concise and conversational. Since this is a voice agent, do not output massive walls of text. Be interruptible.

### Legal Context (Nepal)
- Consumer Protection Act 2075 Section 14: Consumers have the right to get goods/services without harm, the right to information about prices/quality, and the right to compensation against unfair trade.
- Section 16: Right to return goods if they are defective, substandard, or not as described, typically within 7 days.
- Section 50-52: Provisions regarding fines and compensation for businesses that charge above MRP, sell expired goods, or engage in false advertising.
- E-Commerce Directive 2082: E-commerce platforms must have clear grievance handling mechanisms, cannot charge arbitrary hidden fees, and must deliver exactly what was promised online.

### Duties
1. Listen to the user's problem.
2. Ask for a photo of the bill, receipt, or product if helpful (you process multimodal input).
3. Briefly explain which consumer right is violated.
4. Estimate eligibility or simple next steps.
5. Offer to generate a pre-filled complaint text for the Department of Commerce, Supplies and Consumer Protection (DCSCP) Google form or Hello Sarkar.
"""

# Gemini Live configuration
MODEL = "gemini-2.0-flash-exp"

import asyncio

# --- Tool Definitions ---
def generate_complaint_draft(issue_summary: str, company_name: str, consumer_name: str) -> str:
    """Pre-fills a complaint text for the DCSCP or Hello Sarkar based on the user's issue."""
    draft = f"COMPLAINT TO DCSCP/HELLO SARKAR\n\nI, {consumer_name}, wish to file a formal complaint against {company_name}.\n\nIssue Details:\n{issue_summary}\n\nRequested Resolution: Investigation and appropriate compensation as per Nepal Consumer Protection Act 2075."
    print("Generated Draft:", draft)
    return draft

def show_infographic(topic: str) -> dict:
    """Signals the frontend to show a visual explainer/infographic about a consumer rights topic."""
    # In a production app, this could call Imagen3 to generate an actual image and return a base64 string or URL.
    # For MVP, we return a structured action for the frontend to render a neat UI card.
    print(f"Triggered Infographic for: {topic}")
    return {"action": "render_infographic", "topic": topic}

@app.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    try:
        # 1. Build the system instruction parts starting with the text prompt
        instruction_parts = [types.Part.from_text(text=SYSTEM_INSTRUCTION)]
        
        # 2. Append any uploaded PDF documents to the system instructions
        # This gives the agent the actual full legal text as context!
        for doc in uploaded_legal_docs:
             instruction_parts.append(
                 types.Part.from_uri(file_uri=doc.uri, mime_type="application/pdf")
             )
             
        config = types.LiveConnectConfig(
            system_instruction=types.Content(parts=instruction_parts),
            tools=[generate_complaint_draft, show_infographic],
            # Use AUDIO for the response modality to enable voice output
            response_modalities=[types.LiveCommandResponseModality.AUDIO]
        )
        
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            print("Connected to Gemini Live")
            
            async def receive_from_frontend():
                try:
                    while True:
                        # For MVP, assuming frontend sends JSON with either audio base64 chunks or image chunks
                        message = await websocket.receive_text()
                        data = json.loads(message)
                        
                        if "audio" in data:
                            # Send audio chunk to Gemini
                            await session.send(input={"mime_type": "audio/pcm;rate=16000", "data": data["audio"]})
                        elif "image" in data:
                            # Send image/vision frame to Gemini
                            await session.send(input={"mime_type": "image/jpeg", "data": data["image"]})
                        elif "text" in data:
                            await session.send(input={"text": data["text"]})
                except WebSocketDisconnect:
                    print("Frontend Disconnected")

            async def receive_from_gemini():
                try:
                    async for response in session.receive():
                        # Route audio responses back to the frontend
                        if response.server_content and response.server_content.model_turn:
                            for part in response.server_content.model_turn.parts:
                                if part.executable_code:
                                    pass # Ignore code exec for MVP
                                elif part.inline_data:
                                    # This is an audio chunk
                                    audio_b64 = part.inline_data.data.decode("utf-8") if isinstance(part.inline_data.data, bytes) else part.inline_data.data
                                    await websocket.send_text(json.dumps({"type": "audio", "data": audio_b64}))
                        
                        if response.tool_call:
                            # The model called a tool. The SDK handles execution if config contains callables.
                            # We just forward the tool signal to frontend if needed so it can show "Generating Draft..."
                            for call in response.tool_call.function_calls:
                                await websocket.send_text(json.dumps({"type": "tool_call", "name": call.name}))
                except Exception as e:
                    print(f"Gemini receive error: {e}")

            # Run both bidirectional streams concurrently
            await asyncio.gather(
                receive_from_frontend(),
                receive_from_gemini()
            )
            
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error connecting to Gemini: {e}")
        try:
            await websocket.send_json({"error": str(e)})
        except:
            pass
