// `pnpm bench [url]`: requests per second and latency for the app's main paths, against a
// running server. Closed-loop: each caller sends its next request when the last returns.

const base = process.argv[2] ?? "http://localhost:43000";
const PATHS = ["/api/health", "/", "/sign-in", "/docs"];
const CONCURRENCY = [10, 50];
const SECONDS = 8;

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

async function load(path, concurrency) {
  const end = Date.now() + SECONDS * 1000;
  const times = [];
  let failed = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < end) {
        const started = performance.now();
        const response = await fetch(`${base}${path}`).catch(() => null);
        if (!response?.ok) failed += 1;
        await response?.arrayBuffer();
        times.push(performance.now() - started);
      }
    }),
  );
  times.sort((a, b) => a - b);
  return {
    path,
    concurrency,
    rps: Math.round(times.length / SECONDS),
    p50: Math.round(quantile(times, 0.5)),
    p95: Math.round(quantile(times, 0.95)),
    failed,
  };
}

// The load generator shares the machine's cores, and so does anything else running: the
// numbers are comparable run to run on one quiet machine, not across machines.
const rows = [];
for (const path of PATHS)
  for (const concurrency of CONCURRENCY) rows.push(await load(path, concurrency));
console.table(rows);
