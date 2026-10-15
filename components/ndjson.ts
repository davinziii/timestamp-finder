/**
 * Reads a newline-delimited JSON response (from /api/search, /api/moments,
 * /api/clip) and calls onEvent for each line as it arrives.
 */
export async function readNdjson<E>(res: Response, onEvent: (event: E) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest) as E);
}
