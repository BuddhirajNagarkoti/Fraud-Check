import asyncio
from google import genai
from google.genai import types
import os
from dotenv import load_dotenv
from main import MODEL, SYSTEM_INSTRUCTION

load_dotenv()

async def test_live():
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    config = types.LiveConnectConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_modalities=["AUDIO"],
    )
    async with client.aio.live.connect(model=MODEL, config=config) as session:
        print("Connected to", MODEL)
        
        # Test 1: Try sending end_of_turn=True
        try:
            print("Sending end_of_turn=True...")
            await session.send(input="", end_of_turn=True)
            print("Success end_of_turn")
        except Exception as e:
            print("Failed end_of_turn:", e)
            
        # Test 2: Try sending client_content json explicitly
        try:
            print("Sending turn_complete json...")
            await session.send(input={"client_content": {"turn_complete": True}})
            print("Success JSON dict")
        except Exception as e:
            print("Failed JSON struct:", e)

if __name__ == "__main__":
    asyncio.run(test_live())
