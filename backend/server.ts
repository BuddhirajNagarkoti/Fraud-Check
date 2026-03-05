import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GoogleGenAI, Modality } from '@google/genai';
import * as types from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.warn('[WARNING] GEMINI_API_KEY or GOOGLE_API_KEY not set. Voice features will not work.');
}

const SYSTEM_INSTRUCTION = `
You are "Fraud Check", a real-time, voice-first consumer rights companion app for young people in Nepal.
Your core goal is to act as a warm, supportive, and interruptible friend who listens to users' problems,
analyzes them against Nepal's Consumer Protection Act 2075 and E-Commerce Directive 2082, and spots unfair practices.

### Personality & Tone
- Warm, empathetic, and Gen Z-friendly.
- Be concise and conversational. Since this is a voice agent, do not output massive walls of text. Be interruptible.

### Language Rules — VERY IMPORTANT
- **Mirror the user's language.** If the user speaks in Nepali, respond fully in Nepali. If the user speaks in English, respond in English. If they mix both, you can mix both.
- You are fluent in both Nepali and English. Default to the language the user is currently using.
- Legal terms (e.g., section numbers, law names) can stay in English even when speaking Nepali, since they are official terms.
- When greeting for the first time, greet in a mix of English and Nepali since you don't know the user's preference yet.

### Audio Handling
- You are receiving a live audio stream. There WILL be background noise, silence, and ambient sounds.
- Do NOT respond to background noise, static, or unclear sounds. Only respond when you hear clear human speech directed at you.
- If the audio is unclear, stay silent rather than guessing or responding to noise.
- Wait for complete thoughts before responding. Do not interrupt partial sentences.

### Legal Context (Nepal)
- Consumer Protection Act 2075 Section 14: Right to goods/services without harm, right to info about prices/quality, right to compensation.
- Section 16: Right to return defective/substandard goods within 7 days.
- Section 50-52: Fines and compensation for charging above MRP, selling expired goods, false advertising.
- E-Commerce Directive 2082: Clear grievance handling, no hidden fees, deliver exactly what was promised.

### Duties — Follow this order strictly
1. **LISTEN**: Listen to the user's problem fully. Ask clarifying questions if needed. Understand the full situation before giving advice.
2. **EVIDENCE REQUEST**: If the issue involves a physical product (e.g., wrong model, defective, expired), verbally ask the user to upload a photo of it.
3. **IMAGE VERIFICATION**: When the user uploads an image, analyze it. Confirm if it matches their claim.
4. **IDENTIFY VIOLATION**: Explain which consumer right is violated. IMPORTANT: ALWAYS mention the exact section number (e.g. "Section 14", "Section 16", "Section 50") and the law name (e.g. "Consumer Protection Act" or "E-Commerce Directive 2082"). This is critical for the app to display legal cards to the user.
5. **ADVISE ACTIONABLE STEPS**: Before offering to draft any email, ALWAYS first advise the consumer on practical steps they can take on their own:
   - Contact the seller/business directly and demand resolution (refund, replacement, etc.)
   - Keep all receipts, screenshots, and evidence safe
   - Visit the store/office in person with a written complaint if possible
   - Call Hello Sarkar (1111) for immediate government assistance
   - File a complaint at the local DCSCP office
   - Know their deadlines (e.g., 7-day return window under Section 16)
   - Share relevant consumer rights sections so they can cite them when negotiating
   Only after explaining these steps, ask the user: "Would you also like me to draft a formal complaint email to the authorities?"
6. **EMAIL DRAFTING**: ONLY if the user explicitly agrees to drafting an email, dictate it exactly like this:
   "DRAFTING EMAIL. Subject: [Subject Here]. To: [Email Address]. Body: [Body Here]. END OF DRAFT."
   Do NOT draft an email unless the user says yes.
7. **EVIDENCE ATTACHMENT**: If the user asks about attaching photos to the email, enthusiastically reassure them that the app will automatically attach the photos they just uploaded. DO NOT state that you cannot attach files.
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
    pattern: /section\s*(14|fourteen)/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 14',
    violation: 'Right to safe goods/services, price info, quality info, and compensation',
    next_step: 'File complaint at DCSCP or Hello Sarkar',
  },
  {
    pattern: /section\s*(16|sixteen)/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 16',
    violation: 'Right to return defective or substandard goods within 7 days',
    next_step: 'Return the product within 7 days for full refund',
  },
  {
    pattern: /section\s*(50|fifty)/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 50-52',
    violation: 'Fines for charging above MRP, selling expired goods, or false advertising',
    next_step: 'Report to DCSCP for penalty enforcement',
  },
  {
    pattern: /section\s*(51|fifty[\s-]?one)/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 50-52',
    violation: 'Fines for charging above MRP, selling expired goods, or false advertising',
    next_step: 'Report to DCSCP for penalty enforcement',
  },
  {
    pattern: /section\s*(52|fifty[\s-]?two)/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 50-52',
    violation: 'Fines for charging above MRP, selling expired goods, or false advertising',
    next_step: 'Report to DCSCP for penalty enforcement',
  },
  {
    pattern: /e[\s-]?commerce\s*(directive|act|guideline)?\s*(2082|twenty[\s-]?eighty[\s-]?two)?/i,
    law: 'E-Commerce Directive 2082',
    section: 'Directive 2082',
    violation: 'Violations related to grievance handling, hidden fees, or misleading delivery promises',
    next_step: 'File complaint with DCSCP referencing E-Commerce Directive 2082',
  },
  {
    pattern: /consumer\s*protection\s*(act|law)/i,
    law: 'Consumer Protection Act 2075',
    section: 'CPA 2075',
    violation: 'Consumer rights violation under the Consumer Protection Act',
    next_step: 'File complaint at DCSCP or call Hello Sarkar (1111)',
  },
  {
    pattern: /right\s*to\s*return|return\s*(within|the\s*product)|7[\s-]?day|seven[\s-]?day/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 16',
    violation: 'Right to return defective or substandard goods within 7 days',
    next_step: 'Return the product within 7 days for full refund',
  },
  {
    pattern: /above\s*mrp|overcharg|over[\s-]?pric|expired\s*(good|product|item)|false\s*advertis|misleading\s*ad/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 50-52',
    violation: 'Fines for charging above MRP, selling expired goods, or false advertising',
    next_step: 'Report to DCSCP for penalty enforcement',
  },
  {
    pattern: /right\s*to\s*(safe|compensation|info|quality)|consumer\s*right/i,
    law: 'Consumer Protection Act 2075',
    section: 'Section 14',
    violation: 'Right to safe goods/services, price info, quality info, and compensation',
    next_step: 'File complaint at DCSCP or Hello Sarkar',
  },
  {
    pattern: /hidden\s*fee|hidden\s*charge|not\s*as\s*(described|advertised|promised)|grievance\s*handling/i,
    law: 'E-Commerce Directive 2082',
    section: 'Directive 2082',
    violation: 'Violations related to grievance handling, hidden fees, or misleading delivery promises',
    next_step: 'File complaint with DCSCP referencing E-Commerce Directive 2082',
  },
];

// Track which violations have already been sent per session
function createViolationTracker() {
  const sent = new Set<string>();
  return (text: string): ViolationRule[] => {
    const found: ViolationRule[] = [];
    for (const rule of VIOLATION_RULES) {
      if (rule.pattern.test(text) && !sent.has(rule.section)) {
        sent.add(rule.section);
        found.push(rule);
      }
    }
    return found;
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

        // Handle output transcription + detect violations & email drafts
        if (message.serverContent?.outputTranscription?.text) {
          const text = message.serverContent.outputTranscription.text;
          socket.send(JSON.stringify({ type: 'transcript', role: 'agent', text }));

          // Accumulate transcript and check for violation mentions
          transcriptBuffer += text;
          const violations = checkViolation(transcriptBuffer);
          for (const violation of violations) {
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

          // Check for email drafts via STT spoken phrase
          const emailMatch = transcriptBuffer.match(/drafting email[\s\S]*?subject\s*:?\s*([\s\S]*?)to\s*:?\s*([\s\S]*?)body\s*:?\s*([\s\S]*?)end of draft/i);
          if (emailMatch) {
            let subjectStr = emailMatch[1].trim();
            let toStr = emailMatch[2].trim();
            let bodyStr = emailMatch[3].trim();

            // Clean up trailing periods or artifacts from STT
            if (subjectStr.endsWith('.')) subjectStr = subjectStr.slice(0, -1);
            if (toStr.endsWith('.')) toStr = toStr.slice(0, -1);

            socket.send(JSON.stringify({
              type: 'email_draft',
              data: {
                raw: bodyStr,
                subject: subjectStr || 'Consumer Rights Complaint',
                to: toStr.replace(/\s+/g, '').toLowerCase() || '1111@nepal.gov.np' // strip spaces from email
              }
            }));
            // Clear matched chunk to avoid duplicating
            transcriptBuffer = transcriptBuffer.replace(emailMatch[0], '');
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
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', message: 'Voice session error. Please refresh to reconnect.' }));
        }
      },
      onclose: (e: CloseEvent) => {
        console.log('[GEMINI] Session closed:', e.code, e.reason);
        if (socket.readyState === WebSocket.OPEN && e.code !== 1000) {
          socket.send(JSON.stringify({ type: 'error', message: 'Voice session timed out. Refresh to start a new session.' }));
        }
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

  const port = parseInt(process.env.PORT || '8002', 10);

  // Health check for Cloud Run
  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  // Add a route to send email via Gmail API
  app.post('/api/send-email', async (c) => {
    try {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Missing or invalid Authorization header' }, 401);
      }
      const token = authHeader.split(' ')[1];
      const body = await c.req.json();
      const { to, subject, message, attachment } = body;

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: token });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      let emailLines = [];

      if (attachment && attachment.base64 && attachment.name) {
        const boundary = 'fraud_check_boundary_' + Date.now().toString(16);
        emailLines = [
          `To: ${to}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          'MIME-Version: 1.0',
          '',
          message,
          '',
          `--${boundary}`,
          `Content-Type: ${attachment.type || 'image/jpeg'}; name="${attachment.name}"`,
          `Content-Disposition: attachment; filename="${attachment.name}"`,
          'Content-Transfer-Encoding: base64',
          '',
          attachment.base64,
          '',
          `--${boundary}--`
        ];
      } else {
        emailLines = [
          `To: ${to}`,
          'Content-type: text/plain;charset=iso-8859-1',
          'MIME-Version: 1.0',
          `Subject: ${subject}`,
          '',
          message
        ];
      }

      const email = emailLines.join('\r\n');
      const base64EncodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: base64EncodedEmail
        }
      });

      return c.json({ success: true, messageId: res.data.id });
    } catch (error: any) {
      console.error('[GMAIL] Error sending email:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  // Serve frontend static files in production
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  app.use('/*', serveStatic({ root: '../frontend/dist' }));
  // Fallback: serve index.html for client-side routing
  app.get('*', async (c) => {
    const fs = await import('fs/promises');
    const indexPath = path.join(frontendDist, 'index.html');
    try {
      const html = await fs.readFile(indexPath, 'utf-8');
      return c.html(html);
    } catch {
      return c.text('Frontend not built. Run: cd frontend && npm run build', 404);
    }
  });

  const server = serve({ fetch: app.fetch, port });

  const wss = new WebSocketServer({ server: server as any });

  wss.on('connection', async (socket) => {
    console.log('[WS] Client connected');

    let session: types.Session | null = null;
    try {
      session = await createSessionForClient(socket);
    } catch (err) {
      console.error('[WS] Failed to create Gemini session:', err);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'error', message: 'Failed to start voice session. Please try again.' }));
      }
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
          if (msgCount % 50 === 1) console.log(`[WS > GEMINI] Audio chunk #${msgCount}, len = ${message.audio.length} `);
          session.sendRealtimeInput({ media: createBlob(message.audio) });
        } else if (message.text) {
          console.log(`[WS > GEMINI] Text: ${message.text} `);
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: message.text }] }],
            turnComplete: true,
          });
        } else if (message.image) {
          console.log(`[WS > GEMINI] Image received.MimeType: ${message.mimeType} `);
          session.sendRealtimeInput({
            media: {
              mimeType: message.mimeType || 'image/jpeg',
              data: message.image
            }
          });
        }
      } catch (error) {
        console.error('[WS] Parse error:', error);
      }
    });

    socket.on('close', () => {
      console.log('[WS] Client disconnected');
      if (session) {
        try { session.close(); } catch { }
        session = null;
      }
    });

    socket.on('error', (error) => {
      console.error('[WS] Error:', error);
      if (session) {
        try { session.close(); } catch { }
        session = null;
      }
    });
  });

  console.log(`[SERVER] Running on http://localhost:${port}`);
}

main();
