/**
 * 从 URL 抓取并提取文本（服务端代理，避免 CORS）
 */
export async function extractFromUrl(url: string, signal?: AbortSignal): Promise<string> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  };
  if (signal) init.signal = signal;
  const res = await fetch("/api/documents/extract-from-url", init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `URL extraction failed: ${res.status}`);
  }
  const data = await res.json();
  return data.text ?? "";
}
