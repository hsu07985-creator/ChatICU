/**
 * Shared SSE (Server-Sent Events) reader for the AI streaming endpoints.
 *
 * Captures the common read/decode/frame-split/parse loop that previously lived
 * (copy-pasted three times) inside `ai.ts`'s streamChatMessage /
 * streamClinicalEndpoint / streamPolishClinicalText. The network behavior is
 * unchanged — this only extracts the loop with proper types so callers no
 * longer carry `any`-typed payloads.
 *
 * Frame protocol (matches the FastAPI backend):
 * - frames are separated by a blank line (`\n\n`); CRLF is normalized to LF
 * - within a frame, `event:` sets the event name (default `message`)
 * - `data:` lines are concatenated; a single leading space after the colon is
 *   stripped per the SSE spec
 * - on the final read, any trailing non-empty buffer is flushed as one frame
 */

/** A single parsed SSE event: its event name plus the JSON-decoded data. */
export interface SseEvent {
  /** The `event:` field value, or `'message'` when absent. */
  event: string;
  /** The raw concatenated `data:` payload (may be empty). */
  data: string;
  /**
   * `data` parsed as JSON. `null` when `data` is empty OR not valid JSON —
   * mirroring the previous `payload = {}` fallback, but typed so callers must
   * narrow before use instead of reaching through `any`.
   */
  payload: unknown;
}

/**
 * Parse a single raw SSE frame (text between blank-line boundaries) into its
 * `event` name and concatenated `data` payload. Returns `null` for empty /
 * whitespace-only frames.
 */
export function parseSseFrame(frame: string): { event: string; data: string } | null {
  const trimmed = frame.trim();
  if (!trimmed) return null;
  const lines = trimmed.split('\n');
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      data += value.startsWith(' ') ? value.slice(1) : value;
    }
  }
  return { event, data };
}

/**
 * Consume a streaming `Response` body and yield each parsed SSE event in order.
 *
 * The async generator owns the reader/decoder/buffer loop; callers just iterate
 * and switch on `event.event`, reading the typed `event.payload`. Throwing or
 * `break`-ing out of the `for await` releases the reader lock via the generator's
 * `finally`.
 *
 * Throws `Error('AI 串流連線失敗：無可讀取內容。')` if the response has no body —
 * matching the previous inline guard. Callers that need a custom message should
 * check `response.body` before calling.
 */
export async function* readSseEvents(response: Response): AsyncGenerator<SseEvent, void, void> {
  if (!response.body) {
    throw new Error('AI 串流連線失敗：無可讀取內容。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }
      buffer = buffer.replace(/\r\n/g, '\n');
      if (done && buffer.trim()) {
        // Flush any trailing frame that wasn't terminated by a blank line.
        buffer += '\n\n';
      }

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex !== -1) {
        const frame = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf('\n\n');

        const parsed = parseSseFrame(frame);
        if (!parsed) continue;

        let payload: unknown = null;
        if (parsed.data) {
          try {
            payload = JSON.parse(parsed.data);
          } catch {
            payload = null;
          }
        }

        yield { event: parsed.event, data: parsed.data, payload };
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Callback-based variant of {@link readSseEvents}: invokes `onEvent` for each
 * parsed SSE event. Returning `false` (not `undefined`) from `onEvent` stops
 * consumption early and releases the reader. Resolves once the stream is fully
 * drained or `onEvent` requests a stop.
 *
 * `onEvent` may be async; it is awaited before the next event is read, matching
 * the sequential semantics of the original inline loops.
 */
export async function consumeSseEvents(
  response: Response,
  onEvent: (event: SseEvent) => boolean | void | Promise<boolean | void>,
): Promise<void> {
  for await (const event of readSseEvents(response)) {
    const cont = await onEvent(event);
    if (cont === false) break;
  }
}
