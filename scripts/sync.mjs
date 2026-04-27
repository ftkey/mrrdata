import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '.');
const OUT_PATH = path.join(ROOT, 'startups.json');

if (!process.env.TRUST_MRR_API_KEY) {
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        )
          val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
}

const TRUST_MRR_BASE = 'https://trustmrr.com/api/v1';
const LIMIT_PER_PAGE = 50;
const RATE_LIMIT_DELAY_MS = 4000;
const RATE_LIMIT_RETRY_AFTER_MS = 65000;

async function run() {
  const startTime = Date.now();
  const startIso = new Date(startTime).toISOString();
  console.log(`Sync started at ${startIso}`);

  const apiKey = process.env.TRUST_MRR_API_KEY;
  if (!apiKey) {
    throw new Error('TRUST_MRR_API_KEY is not set');
  }

  const allStartups = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${TRUST_MRR_BASE}/startups?page=${page}&limit=${LIMIT_PER_PAGE}&sort=revenue-desc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 429) {
      const retryAfter =
        Number(res.headers.get('Retry-After')) * 1000 ||
        RATE_LIMIT_RETRY_AFTER_MS;
      console.log(`Rate limited; waiting ${retryAfter / 1000}s...`);
      await new Promise((r) => setTimeout(r, retryAfter));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TrustMRR API error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const now = Date.now();
    // 1:1 passthrough — keep every field exactly as the API returns it
    const batch = json.data.map((item) => ({
      ...item,
      lastSyncedAt: now,
    }));
    allStartups.push(...batch);
    hasMore = json.meta?.hasMore ?? false;
    console.log(
      `Page ${page}: ${batch.length} startups (total ${allStartups.length})`,
    );
    page++;
    if (hasMore) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  const output = {
    syncedAt: new Date().toISOString(),
    startups: allStartups,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 4), 'utf8');
  const endTime = Date.now();
  const endIso = new Date(endTime).toISOString();
  const durationMs = endTime - startTime;
  const durationSec = (durationMs / 1000).toFixed(1);
  console.log(`Wrote ${allStartups.length} startups to ${OUT_PATH}`);
  console.log(
    `Sync finished at ${endIso} (started ${startIso}, duration ${durationSec}s)`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
