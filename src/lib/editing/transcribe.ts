import fs from "node:fs";
import { env } from "@/lib/env";
import type { Transcript, TranscriptWord } from "@/lib/types";

// Word-level transcription. Providers are OpenAI-compatible Whisper endpoints
// (OpenAI, Groq) or Deepgram. With no key configured, "mock" aligns the script
// text evenly across the footage so the rest of the pipeline stays usable.

export type TranscribeProvider = "openai" | "groq" | "deepgram" | "mock";

export function detectProvider(): TranscribeProvider {
  const forced = env.transcribe.provider as TranscribeProvider | "";
  if (forced) return forced;
  if (env.transcribe.openaiKey) return "openai";
  if (env.transcribe.groqKey) return "groq";
  if (env.transcribe.deepgramKey) return "deepgram";
  return "mock";
}

export async function transcribe(
  wavPath: string,
  opts: { duration: number; scriptHint?: string; language?: string },
): Promise<Transcript> {
  const provider = detectProvider();
  switch (provider) {
    case "openai":
      return whisperCompatible(wavPath, "https://api.openai.com/v1", env.transcribe.openaiKey, "whisper-1", opts, "openai");
    case "groq":
      return whisperCompatible(
        wavPath,
        "https://api.groq.com/openai/v1",
        env.transcribe.groqKey,
        "whisper-large-v3",
        opts,
        "groq",
      );
    case "deepgram":
      return deepgram(wavPath, opts);
    default:
      return mockTranscript(opts.scriptHint || "", opts.duration);
  }
}

async function whisperCompatible(
  wavPath: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: { scriptHint?: string; language?: string },
  provider: string,
): Promise<Transcript> {
  const form = new FormData();
  const buf = fs.readFileSync(wavPath);
  form.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (opts.language) form.append("language", opts.language);
  if (opts.scriptHint) form.append("prompt", opts.scriptHint.slice(0, 800));
  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const data = (await res.json()) as {
    text?: string;
    language?: string;
    words?: Array<{ word: string; start: number; end: number }>;
    segments?: Array<{ text: string; start: number; end: number }>;
  };
  let words: TranscriptWord[] = (data.words || []).map((w) => ({
    text: w.word.trim(),
    start: Number(w.start),
    end: Number(w.end),
  }));
  if (words.length === 0 && data.segments?.length) {
    // Provider returned only segments; spread words evenly inside each segment.
    words = data.segments.flatMap((seg) => spreadWords(seg.text, seg.start, seg.end));
  }
  words = punctuateFromText(words, data.text || "");
  return { words, text: data.text || words.map((w) => w.text).join(" "), provider, language: data.language };
}

async function deepgram(wavPath: string, opts: { language?: string; scriptHint?: string }): Promise<Transcript> {
  const params = new URLSearchParams({ model: "nova-3", smart_format: "true", punctuate: "true", filler_words: "true" });
  if (opts.language) params.set("language", opts.language);
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${env.transcribe.deepgramKey}`, "Content-Type": "audio/wav" },
    body: fs.readFileSync(wavPath),
  });
  if (!res.ok) throw new Error(`Deepgram failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const data = (await res.json()) as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string;
          words?: Array<{ word: string; punctuated_word?: string; start: number; end: number; confidence?: number }>;
        }>;
      }>;
    };
  };
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  const words: TranscriptWord[] = (alt?.words || []).map((w) => ({
    text: (w.punctuated_word || w.word).trim(),
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));
  return { words, text: alt?.transcript || "", provider: "deepgram" };
}

function spreadWords(text: string, start: number, end: number): TranscriptWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const per = Math.max(0.05, (end - start) / tokens.length);
  return tokens.map((t, i) => ({ text: t, start: start + i * per, end: start + (i + 1) * per }));
}

/**
 * Whisper word timestamps come without punctuation; copy punctuation from the
 * full text back onto the words so sentence boundaries survive.
 */
function punctuateFromText(words: TranscriptWord[], text: string): TranscriptWord[] {
  if (!text || !words.length) return words;
  const tokens = text.trim().split(/\s+/);
  if (Math.abs(tokens.length - words.length) > Math.max(3, words.length * 0.1)) return words;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  let ti = 0;
  return words.map((w) => {
    // find the next token that matches this word
    for (let k = ti; k < Math.min(tokens.length, ti + 3); k++) {
      if (norm(tokens[k]) === norm(w.text)) {
        ti = k + 1;
        return { ...w, text: tokens[k] };
      }
    }
    return w;
  });
}

export function mockTranscript(script: string, duration: number): Transcript {
  const tokens = script.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!tokens.length || duration <= 0) return { words: [], text: "", provider: "mock" };
  const lead = Math.min(0.6, duration * 0.05);
  const usable = Math.max(0.5, duration - lead * 2);
  const per = usable / tokens.length;
  const words: TranscriptWord[] = tokens.map((t, i) => ({
    text: t,
    start: +(lead + i * per).toFixed(3),
    end: +(lead + (i + 1) * per - Math.min(0.05, per * 0.2)).toFixed(3),
  }));
  return { words, text: tokens.join(" "), provider: "mock" };
}
