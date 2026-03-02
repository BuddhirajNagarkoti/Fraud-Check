import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GoogleGenAI, Modality } from '@google/genai';
import * as types from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error('GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set');
  process.exit(1);
}

const SYSTEM_INSTRUCTION = `
You are "Fraud Check", a real-time, voice-first consumer rights companion app for young people in Nepal.
Your core goal is to act as a warm, supportive, and interruptible friend who listens to users' problems,
analyzes them against Nepal's Consumer Protection Act 2075 and E-Commerce Directive 2082, and spots unfair practices.

### Personality & Tone
- Warm, empathetic, and Gen Z-friendly.
- Bilingual: Understand and speak contextual English mixed with a bit of Nepali slangs if appropriate.
- Be concise and conversational. Since this is a voice agent, do not output massive walls of text. Be interruptible.

### Legal Context (Nepal)
- Consumer Protection Act 2075 Section 14: Right to goods/services without harm, right to info about prices/quality, right to compensation.
- Section 16: Right to return defective/substandard goods within 7 days.
- Section 50-52: Fines and compensation for charging above MRP, selling expired goods, false advertising.
- E-Commerce Directive 2082: Clear grievance handling, no hidden fees, deliver exactly what was promised.

### Duties
1. Listen to the user's problem.
2. Briefly explain which consumer right is violated.
3. Estimate eligibility or simple next steps.
4. Offer to generate a pre-filled complaint text for DCSCP or Hello Sarkar.
5. IMPORTANT: When you identify a violation, ALWAYS mention the exact section number (e.g. "Section 14", "Section 16", "Section 50") and the law name (e.g. "Consumer Protection Act" or "E-Commerce Directive 2082"). This is critical for the app to display legal cards to the user.
`;

function createBlob(audioData: string): types.Blob {
  return { data: audioData, mimeType: 'audio/pcm;rate=16000' };
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
const model = 'gemini-2.5-flash-native-audio-latest';

// --- Transcript-based violation detection ---
// Since native audio model doesn't support function calling reliably,
// we parse the agent's transcript to detect law/section mentions.

interface ViolationRule {
  pattern: RegExp;
  law: string;
  section: string;
  violation: string;
  next_step: string;
}

const VIOLATION_RULES: ViolationRule[] = [
  {
    pattern: /section\s*14/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 14',
    violation: 'Right to safe goods/services, price info, quality info, and compensation',
    next_step: 'File complaint at DCSCP or Hello Sarkar',
  },
  {
    pattern: /section\s*16/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 16',
    violation: 'Right to return defective or substandard goods within 7 days',
    next_step: 'Return the product within 7 days for full refund',
  },
  {
    pattern: /section\s*50/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 50-52',
    violation: 'Fines for charging above MRP, selling expired goods, or false advertising',
    next_step: 'Report to DCSCP for penalty enforcement',
  },
  {
    pattern: /section\s*51/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 50-52',
    violation: 'Fines for charging above MRP, selling expired goods, or false advertising',
    next_step: 'Report to DCSCP for penalty enforcement',
  },
  {
    pattern: /section\s*52/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 50-52',
    violation: 'Fines for charging above MRP, selling expired goods, or false advertising',
    next_step: 'Report to DCSCP for penalty enforcement',
  },
  {
    pattern: /e-?commerce\s*(directive|act)\s*2082/i,
    law: 'E-Commerce Directive 2082',
    section: 'Directive 2082',
    violation: 'Violations related to grievance handling, hidden fees, or misleading delivery promises',
    next_step: 'File complaint with DCSCP referencing E-Commerce Directive 2082',
  },
  {
    pattern: /consumer\s*protection\s*act/i,
    law: 'Consumer Protection Act 2075',
    section: 'CPA 2075',
    violation: 'Consumer rights violation under the Consumer Protection Act',
    next_step: 'File complaint at DCSCP or call Hello Sarkar (1111)',
  },
];

// Track which violations have already been sent per session
function createViolationTracker() {
  const sent = new Set<string>();
  return (text: string): ViolationRule | null => {
    for (const rule of VIOLATION_RULES) {
      if (rule.pattern.test(text) && !sent.has(rule.section)) {
        sent.add(rule.section);
        return rule;
      }
    }
    return null;
  };
}

async function createSessionForClient(socket: WebSocket) {
  const config: types.LiveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr',
        },
      },
    },
    // Note: native audio model doesn't support function calling reliably
    // Violations are detected from transcript text instead
  };

  console.log(`[GEMINI] Creating new session for client...`);

  const checkViolation = createViolationTracker();
  let transcriptBuffer = '';

  const session = await ai.live.connect({
    model,
    config,
    callbacks: {
      onopen: () => {
        console.log('[GEMINI] Session opened');
      },
      onmessage: (message: types.LiveServerMessage) => {
        if (socket.readyState !== WebSocket.OPEN) return;

        // Debug: log message keys
        const keys = Object.keys(message).filter(k => (message as any)[k] != null);
        if (keys.some(k => k !== 'serverContent') || message.toolCall) {
          console.log(`[GEMINI] Message keys: ${keys.join(', ')}`);
        }

        // Handle audio + text data from model turns
        if (
          message.serverContent?.modelTurn?.parts &&
          message.serverContent.modelTurn.parts.length > 0
        ) {
          message.serverContent.modelTurn.parts.forEach((part) => {
            if (part.inlineData?.data) {
              socket.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
            }
            if (part.text) {
              console.log(`[GEMINI] Text part: ${part.text.substring(0, 100)}`);
            }
          });
        }

        // Handle output transcription + detect violations
        if (message.serverContent?.outputTranscription?.text) {
          const text = message.serverContent.outputTranscription.text;
          socket.send(JSON.stringify({ type: 'transcript', role: 'agent', text }));

          // Accumulate transcript and check for violation mentions
          transcriptBuffer += text;
          const violation = checkViolation(transcriptBuffer);
          if (violation) {
            console.log(`[VIOLATION] Detected: ${violation.section} - ${violation.law}`);
            socket.send(JSON.stringify({
              type: 'violation',
              data: {
                law: violation.law,
                section: violation.section,
                violation: violation.violation,
                next_step: violation.next_step,
              },
            }));
          }
        }

        // Handle input transcription (user speech)
        if (message.serverContent?.inputTranscription?.text) {
          const text = message.serverContent.inputTranscription.text;
          socket.send(JSON.stringify({ type: 'transcript', role: 'user', text }));
        }

        // Handle interruption
        if (message.serverContent?.interrupted) {
          console.log('[GEMINI] Interruption detected');
          socket.send(JSON.stringify({ type: 'interrupt' }));
        }
      },
      onerror: (e: ErrorEvent) => {
        console.error('[GEMINI] Error:', e.message);
      },
      onclose: (e: CloseEvent) => {
        console.log('[GEMINI] Session closed:', e.code, e.reason);
      },
    },
  });

  // Send greeting
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: 'Greet the user warmly in a friendly, Gen Z style. Keep it short - just 1-2 sentences.' }] }],
    turnComplete: true,
  });
  console.log('[GEMINI] Greeting sent');

  return session;
}

async function main() {
  const app = new Hono();
  app.use('/*', cors());

  const port = 8002;
  const server = serve({ fetch: app.fetch, port });

  const wss = new WebSocketServer({ server });

  wss.on('connection', async (socket) => {
    console.log('[WS] Client connected');

    let session: types.Session | null = null;
    try {
      session = await createSessionForClient(socket);
    } catch (err) {
      console.error('[WS] Failed to create Gemini session:', err);
      socket.close();
      return;
    }

    let msgCount = 0;

    socket.on('message', (data) => {
      if (!session) return;
      try {
        const message = JSON.parse(data.toString());
        msgCount++;

        if (message.audio) {
          if (msgCount % 50 === 1) console.log(`[WS>GEMINI] Audio chunk #${msgCount}, len=${message.audio.length}`);
          session.sendRealtimeInput({ media: createBlob(message.audio) });
        } else if (message.text) {
          console.log(`[WS>GEMINI] Text: ${message.text}`);
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: message.text }] }],
            turnComplete: true,
          });
        }
      } catch (error) {
        console.error('[WS] Parse error:', error);
      }
    });

    socket.on('close', () => {
      console.log('[WS] Client disconnected');
      if (session) {
        try { session.close(); } catch {}
        session = null;
      }
    });

    socket.on('error', (error) => {
      console.error('[WS] Error:', error);
      if (session) {
        try { session.close(); } catch {}
        session = null;
      }
    });
  });

  console.log(`[SERVER] Running on http://localhost:${port}`);
}

main();
