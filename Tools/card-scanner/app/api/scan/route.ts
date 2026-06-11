import { NextRequest, NextResponse } from 'next/server';
import { buildFewShotBlock } from '@/lib/feedback';
import type { FeedbackItem } from '@/lib/feedback';

export interface StepLog {
  step: string;
  input: string;
  output: string;
  durationMs: number;
  ok: boolean;
}

// ── Shared prompt ─────────────────────────────────────────────────────────────

const FIELD_SPEC = `{
  "name": "person full name",
  "role": "job title or designation",
  "company": "company or organisation name",
  "email": "email address(es) — use | to separate multiple",
  "phone": "phone/mobile number(s) — use | to separate multiple",
  "address": "full postal or street address",
  "website": "website URL(s) — use | to separate multiple",
  "additional": "social handles, fax with label, tagline, or any other text not captured above"
}`;

const RULES = `Rules:
- Read ALL text on the card including small print
- Use "" for missing fields — never guess
- Separate multiple values with " | "
- Put fax numbers in additional with the label "Fax:"
- Put URLs/domains starting with http, www, or ending in .com/.io/.org etc in website
- Put physical/postal addresses in address
- Return ONLY the JSON object. No markdown fences, no explanation.`;

function buildPrompt(fewShot: string): string {
  return [
    fewShot,
    'You are reading a business card image. Extract every piece of visible text and map it to the correct field.',
    `\nReturn ONLY this JSON object:\n${FIELD_SPEC}\n\n${RULES}`,
  ].join('');
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function extractJSON(s: string): Record<string, string> {
  const clean = stripFences(s);
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('No JSON object found in model response');
}

function approxKB(base64: string) { return Math.round((base64.length * 3) / 4 / 1024); }

// ── Ollama ────────────────────────────────────────────────────────────────────

const OLLAMA_VISION_PREFS = ['llava', 'llava-phi3', 'llava-llama3', 'bakllava', 'moondream', 'minicpm-v'];

function pickOllama(names: string[], prefs: string[]): string | null {
  for (const p of prefs) {
    const m = names.find(n => n === p || n.startsWith(`${p}:`));
    if (m) return m;
  }
  return null;
}

async function callOllama(
  baseUrl: string, image: string, mediaType: string,
  prompt: string, fbLen: number,
): Promise<{ output: string; model: string; steps: StepLog[] }> {
  const steps: StepLog[] = [];

  const t0 = Date.now();
  let allModels: string[] = [];
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const { models } = await r.json() as { models: Array<{ name: string }> };
      allModels = models?.map(m => m.name) ?? [];
    }
  } catch { /* not running */ }

  const visionModel = pickOllama(
    allModels.filter(n => OLLAMA_VISION_PREFS.some(p => n === p || n.startsWith(`${p}:`))),
    OLLAMA_VISION_PREFS,
  );

  steps.push({
    step: 'Model Discovery',
    input: `GET ${baseUrl}/api/tags`,
    output: allModels.length
      ? `${allModels.length} model(s) found\nVision: ${visionModel ?? 'none'}\nAll: ${allModels.join(', ')}`
      : `Ollama not reachable at ${baseUrl}\nInstall a vision model: ollama pull llava`,
    durationMs: Date.now() - t0,
    ok: Boolean(visionModel),
  });

  if (!visionModel) {
    throw new Error(
      allModels.length
        ? `No vision model at ${baseUrl}. Run: ollama pull llava`
        : `Ollama not reachable at ${baseUrl}. Is it running?`,
    );
  }

  const t1 = Date.now();
  const r = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: visionModel, stream: false,
      messages: [{ role: 'user', content: prompt, images: [image] }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text().catch(() => '')}`);
  const data = await r.json() as { message?: { content?: string } };
  const output = data.message?.content?.trim() ?? '';

  steps.push({
    step: 'Vision Extraction (Ollama)',
    input: `Model: ${visionModel}\nImage: ${mediaType} (~${approxKB(image)} KB)\nFew-shot corrections: ${fbLen}`,
    output: output || '(empty response)',
    durationMs: Date.now() - t1,
    ok: Boolean(output),
  });

  if (!output) throw new Error('Ollama returned empty response');
  return { output, model: visionModel, steps };
}

// ── Groq (free, OpenAI-compatible, Llama 4 Scout vision) ─────────────────────

const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

async function callGroq(
  apiKey: string, image: string, mediaType: string,
  prompt: string, fbLen: number,
): Promise<{ output: string; model: string; steps: StepLog[] }> {
  const t = Date.now();
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 512,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await r.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  const durationMs = Date.now() - t;
  if (!r.ok) {
    const msg = data.error?.message ?? `Groq HTTP ${r.status}`;
    return {
      output: '', model: GROQ_MODEL,
      steps: [{ step: 'Vision Extraction (Groq)', input: `Model: ${GROQ_MODEL}`, output: `Error: ${msg}`, durationMs, ok: false }],
    };
  }

  const output = data.choices?.[0]?.message?.content?.trim() ?? '';
  return {
    output, model: GROQ_MODEL,
    steps: [{
      step: 'Vision Extraction (Groq)',
      input: `Model: ${GROQ_MODEL}\nImage: ${mediaType} (~${approxKB(image)} KB)\nFew-shot corrections: ${fbLen}`,
      output: output || '(empty response)',
      durationMs, ok: Boolean(output),
    }],
  };
}

// ── Gemini (free, 1 500 req/day) ──────────────────────────────────────────────

// gemini-1.5-flash is more permissive with images than 2.0-flash and widely available
const GEMINI_MODEL = 'gemini-1.5-flash';

async function callGemini(
  apiKey: string, image: string, mediaType: string,
  prompt: string, fbLen: number,
): Promise<{ output: string; model: string; steps: StepLog[] }> {
  const t = Date.now();
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mediaType, data: image } },
          { text: prompt },
        ] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
        // Disable safety blocks that sometimes fire on business card images
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  // Read raw text first so we can always show it in the step breakdown
  const rawText = await r.text();
  const durationMs = Date.now() - t;
  const stepInput = `Model: ${GEMINI_MODEL}\nImage: ${mediaType} (~${approxKB(image)} KB)\nFew-shot corrections: ${fbLen}`;

  let data: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; status?: string };
  };
  try { data = JSON.parse(rawText); } catch { data = {}; }

  if (!r.ok) {
    const msg = data.error?.message ?? `HTTP ${r.status}`;
    return {
      output: '', model: GEMINI_MODEL,
      steps: [{ step: 'Vision Extraction (Gemini)', input: stepInput,
        output: `Error ${r.status}: ${msg}\n\nHint: API keys from AI Studio start with "AIza" — verify yours at aistudio.google.com\n\nFull response:\n${rawText}`,
        durationMs, ok: false }],
    };
  }

  // Prompt-level safety block (no candidates returned)
  if (data.promptFeedback?.blockReason) {
    return {
      output: '', model: GEMINI_MODEL,
      steps: [{ step: 'Vision Extraction (Gemini)', input: stepInput,
        output: `Blocked by safety filter: ${data.promptFeedback.blockReason}\n\nFull response:\n${rawText}`,
        durationMs, ok: false }],
    };
  }

  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason ?? 'UNKNOWN';
  const output = candidate?.content?.parts?.[0]?.text?.trim() ?? '';

  if (!output) {
    return {
      output: '', model: GEMINI_MODEL,
      steps: [{ step: 'Vision Extraction (Gemini)', input: stepInput,
        output: `Empty response (finishReason: ${finishReason})\n\nFull API response:\n${rawText}`,
        durationMs, ok: false }],
    };
  }

  return {
    output, model: GEMINI_MODEL,
    steps: [{
      step: 'Vision Extraction (Gemini)',
      input: stepInput,
      output,
      durationMs, ok: Boolean(output),
    }],
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    image: string;
    mediaType: string;
    feedbackExamples?: FeedbackItem[];
    source: 'ollama' | 'groq' | 'gemini';
    ollamaUrl?: string;
    apiKey?: string;
  };

  const { image, mediaType, feedbackExamples = [], source } = body;
  if (!image || !mediaType) return NextResponse.json({ error: 'image and mediaType are required' }, { status: 400 });

  if (source === 'gemini' && !body.apiKey) {
    return NextResponse.json({ error: 'Gemini API key required. Get one free at aistudio.google.com', steps: [] }, { status: 400 });
  }

  const fewShot = buildFewShotBlock(feedbackExamples);
  const prompt = buildPrompt(fewShot);

  let providerResult: { output: string; model: string; steps: StepLog[] };
  try {
    if (source === 'groq') {
      const groqKey = body.apiKey || process.env.GROQ_API_KEY;
      if (!groqKey) return NextResponse.json({ error: 'Groq API key required. Get one free at console.groq.com', steps: [] }, { status: 400 });
      providerResult = await callGroq(groqKey, image, mediaType, prompt, feedbackExamples.length);
    } else if (source === 'gemini') {
      providerResult = await callGemini(body.apiKey!, image, mediaType, prompt, feedbackExamples.length);
    } else {
      const url = (body.ollamaUrl ?? 'http://localhost:11434').replace(/\/$/, '');
      providerResult = await callOllama(url, image, mediaType, prompt, feedbackExamples.length);
    }
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Scan failed',
      steps: [],
    }, { status: 503 });
  }

  const { output: rawOutput, model: usedModel, steps } = providerResult;

  if (!rawOutput) {
    return NextResponse.json({ error: 'Model returned empty response', steps }, { status: 422 });
  }

  // JSON parse step
  const t2 = Date.now();
  let parsed: Record<string, string>;
  try {
    parsed = extractJSON(rawOutput);
    steps.push({
      step: 'JSON Parse',
      input: rawOutput,
      output: JSON.stringify(parsed, null, 2),
      durationMs: Date.now() - t2,
      ok: true,
    });
  } catch (err) {
    steps.push({
      step: 'JSON Parse',
      input: rawOutput,
      output: `Parse failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - t2,
      ok: false,
    });
    return NextResponse.json({ error: 'Model returned non-JSON output', raw: rawOutput, steps }, { status: 422 });
  }

  return NextResponse.json({
    name:       String(parsed.name       ?? ''),
    role:       String(parsed.role       ?? ''),
    company:    String(parsed.company    ?? ''),
    email:      String(parsed.email      ?? ''),
    phone:      String(parsed.phone      ?? ''),
    address:    String(parsed.address    ?? ''),
    website:    String(parsed.website    ?? ''),
    additional: String(parsed.additional ?? ''),
    _model:  usedModel,
    _source: source,
    steps,
  });
}
