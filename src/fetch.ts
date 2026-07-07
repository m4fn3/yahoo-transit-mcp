/**
 * 共有fetchユーティリティ。
 * - 直列キュー（同時1リクエスト）+ リクエスト間 1.5s 空け
 * - URL単位の15分インメモリキャッシュ
 * - 10sタイムアウト、ネットワークエラーのみ1回リトライ（4xx/5xxはリトライしない）
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 1500;
const TIMEOUT_MS = 10_000;

const cache = new Map<string, { body: string; at: number }>();

let queue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function doFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "ja",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Yahoo!乗換案内へのリクエストが失敗しました (HTTP ${res.status}): ${url}`);
  }
  return res.text();
}

/** レート制限・キャッシュ付きでHTMLを取得する */
export async function fetchHtml(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.body;
  }

  const run = queue.then(async () => {
    // キュー待ちの間にキャッシュが埋まった場合はそれを使う
    const c = cache.get(url);
    if (c && Date.now() - c.at < CACHE_TTL_MS) return c.body;

    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);

    let body: string;
    try {
      lastRequestAt = Date.now();
      body = await doFetch(url);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Yahoo!乗換案内への")) throw e;
      // ネットワーク系のみ1回リトライ
      await sleep(1000);
      lastRequestAt = Date.now();
      body = await doFetch(url);
    }
    cache.set(url, { body, at: Date.now() });
    return body;
  });

  // 後続のためにエラーを飲み込んだ形でキューを進める
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function buildUrl(path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(path, "https://transit.yahoo.co.jp");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}
