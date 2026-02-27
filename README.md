# Fraud Check

Fraud Check is a real-time, voice-first consumer rights companion app for young people in Nepal. 
It acts as a caring friend that listens to user problems (e.g., e-commerce fraud, delivery issues, unfair pricing) and analyzes them against Nepal’s Consumer Protection Act 2075 and E-Commerce Directive 2082. 
It uses the Gemini Live API for real-time multimodal (voice + vision) interactions.

## Features
- **Real-Time Voice & Vision:** Talk to the agent live or show receipts/bills via camera.
- **Legal Context Aware:** Infused with Nepali consumer rights laws to provide accurate, contextually relevant advice.
- **Supportive Persona:** Gen-Z friendly, warm, empathetic, and bilingual (Nepali/English).
- **Multimodal Generation:** The agent can generate explainers or infographic-style diagrams for complex situations.
- **Actionable Output:** Pre-fills complaint templates for the Department of Commerce, Supplies and Consumer Protection (DCSCP) or Hello Sarkar.

## Project Structure
- `backend/`: FastAPI Python server handling WebSocket streams with the Gemini Live API.
- `frontend/`: React + Vite application providing the user interface (mic + camera).

## Prerequisites
- Node.js & npm (for the frontend)
- Python 3.10+ (for the backend)
- Google Gemini API Key with access to the Live API (`gemini-2.0-flash-exp` recommended).
- Google Cloud SDK (if deploying to Cloud Run).

## Local Setup

### 1. Backend Setup
```bash
cd backend
python -m venv venv
# On Windows: venv\Scripts\activate
# On Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` directory:
```env
# backend/.env
GEMINI_API_KEY="your-gemini-api-key-here"
```

Start the FastAPI server:
```bash
uvicorn main:app --reload --port 8000
```
The WebSocket endpoint will be available at `ws://localhost:8000/stream`.

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

## Deployment (Google Cloud Run)

### Backend Deployment
1. Ensure you have the `gcloud` CLI installed and authenticated.
2. Initialize or set your GCP project:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```
3. Deploy the backend using Google Cloud Run:
   ```bash
   cd backend
   gcloud run deploy fraud-check-backend \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars="GEMINI_API_KEY=your_api_key_here"
   ```

### Frontend Deployment
The frontend can be easily deployed to Vercel, Netlify, or Firebase Hosting. Ensure that the `VITE_WS_URL` environment variable for the frontend is updated to point to your new Cloud Run WebSocket endpoint (e.g., `wss://your-backend-url.run.app/stream`).
