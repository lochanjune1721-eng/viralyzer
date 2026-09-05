import path from "node:path";

export const env = {
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  // On serverless hosts the project directory is read-only; fall back to /tmp
  // (ephemeral, see README "Hosting").
  dataDir: path.resolve(process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/viralyzer/data" : "./data")),
  storageDir: path.resolve(process.env.STORAGE_DIR || (process.env.VERCEL ? "/tmp/viralyzer/storage" : "./storage")),
  appSecret: process.env.APP_SECRET || "dev-secret-change-me",
  llm: {
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || "",
    baseUrl: (process.env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "deepseek-chat",
  },
  transcribe: {
    provider: process.env.TRANSCRIBE_PROVIDER || "",
    openaiKey: process.env.OPENAI_API_KEY || "",
    groqKey: process.env.GROQ_API_KEY || "",
    deepgramKey: process.env.DEEPGRAM_API_KEY || "",
    elevenlabsKey: process.env.ELEVENLABS_API_KEY || "",
  },
  images: {
    pexels: process.env.PEXELS_API_KEY || "",
    unsplash: process.env.UNSPLASH_ACCESS_KEY || "",
    googleKey: process.env.GOOGLE_CSE_KEY || "",
    googleCx: process.env.GOOGLE_CSE_CX || "",
  },
  publish: {
    provider: (process.env.PUBLISH_PROVIDER || (process.env.AYRSHARE_API_KEY ? "ayrshare" : "native")) as
      | "native"
      | "ayrshare",
    ayrshareKey: process.env.AYRSHARE_API_KEY || "",
  },
  oauth: {
    google: { id: process.env.GOOGLE_CLIENT_ID || "", secret: process.env.GOOGLE_CLIENT_SECRET || "" },
    tiktok: { id: process.env.TIKTOK_CLIENT_KEY || "", secret: process.env.TIKTOK_CLIENT_SECRET || "" },
    instagram: { id: process.env.INSTAGRAM_APP_ID || "", secret: process.env.INSTAGRAM_APP_SECRET || "" },
    x: { id: process.env.X_CLIENT_ID || "", secret: process.env.X_CLIENT_SECRET || "" },
    linkedin: { id: process.env.LINKEDIN_CLIENT_ID || "", secret: process.env.LINKEDIN_CLIENT_SECRET || "" },
  },
};
