import asyncio
from google import genai
from google.genai import types
import os
from dotenv import load_dotenv

load_dotenv()

async def test_live():
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
    )
    async with client.aio.live.connect(model="gemini-2.5-flash-native-audio-latest", config=config) as session:
        print("Connected.")
        
        try:
            print("1. Sending client content...")
            await getattr(session, "send_client_content")(
                turn_complete=True
            )
            print("Success 1")
        except Exception as e:
            print("Failed 1:", e)
            
        try:
            print("2. Sending client content via content kwarg...")
            await session.send_client_content(
                client_content=types.LiveClientContent(turn_complete=True)
            )
            print("Success 2")
        except Exception as e:
            print("Failed 2:", e)

        try:
            print("3. Sending realtime input with realtime_input...")
            await session.send_realtime_input(
                realtime_input=[{"mime_type": "audio/pcm;rate=16000", "data": b"dummy"}]
            )
            print("Success 3")
        except Exception as e:
            print("Failed 3:", e)

if __name__ == "__main__":
    asyncio.run(test_live())
