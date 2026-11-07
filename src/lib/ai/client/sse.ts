// Incremental decoder for the assistant's server-sent events. Frames may split
// across network chunks, arrive with CRLF line endings, or end without a final
// blank line. The decoder is pure, so the browser and the tests share it.

export interface SseDecoder<T> {
  /** Feeds a chunk of text and returns every event that is now complete. */
  push(chunk: string): T[];
  /** Returns the event still buffered at end of stream, if it is complete. */
  flush(): T[];
}

export function createSseDecoder<T>(parse: (value: unknown) => T | null): SseDecoder<T> {
  let buffer = "";

  const decodeFrame = (frame: string): T[] => {
    const payload = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
      .join("\n");
    if (payload.length === 0) return [];
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      return [];
    }
    const event = parse(value);
    return event === null ? [] : [event];
  };

  return {
    push(chunk) {
      buffer += chunk.replace(/\r\n/g, "\n");
      const events: T[] = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        events.push(...decodeFrame(buffer.slice(0, boundary)));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      return events;
    },
    flush() {
      const rest = buffer;
      buffer = "";
      return rest.trim().length > 0 ? decodeFrame(rest) : [];
    },
  };
}
