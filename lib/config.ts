// Vercel sets VERCEL=1 in every build/runtime environment (dev, preview, prod) on the platform.
// Serverless instances there don't share memory, so the streaming route falls back to DB
// polling. Anywhere else (local dev, a long-running host like EC2) is a single persistent
// process, so an in-memory pub/sub gives real push delivery with near-zero latency.
export const IS_VERCEL = process.env.VERCEL === "1";
