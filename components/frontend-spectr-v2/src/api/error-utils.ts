// Story 2.2 review-fix P26 / wave-2 E2.4·E3.7 — single source of truth for
// parsing server error bodies. The BFF speaks THREE shapes and every surface
// must render the server's wording when one exists:
//   1. AR38 envelope:        { error: { code, message, details? } }
//   2. legacy:               { error: "text" }            (~120 older sites)
//   3. RFC7807 ValidationProblem: { title, errors?: { field: ["msg"] }, detail? }
// `code` is populated ONLY for the envelope shape — code-keyed branches
// (entitlement_exhausted, coach_cap_reached, …) must never fire off legacy or
// problem bodies.

export interface ParsedApiError {
  code?: string;
  message?: string;
}

/** Parse an already-JSON-decoded error body. Total — never throws. */
export function parseErrorBody(body: unknown): ParsedApiError {
  if (typeof body !== 'object' || body === null) return {};
  const b = body as Record<string, unknown>;

  // 1. AR38 envelope — the only shape that carries a machine code.
  if (typeof b.error === 'object' && b.error !== null) {
    const e = b.error as Record<string, unknown>;
    const out: ParsedApiError = {};
    if (typeof e.code === 'string') out.code = e.code;
    if (typeof e.message === 'string') out.message = e.message;
    return out;
  }

  // 2. Legacy { error: "text" } (also covers hybrids like
  //    { error: "text", status: "exists" } — VerdictEndpoints:186).
  if (typeof b.error === 'string') return { message: b.error };

  // 3. RFC7807 ValidationProblem — flatten to the first message of the first
  //    `errors` field (any concrete message beats "HTTP 400"), then fall back
  //    to detail, then title.
  if (typeof b.title === 'string') {
    if (typeof b.errors === 'object' && b.errors !== null) {
      for (const messages of Object.values(b.errors as Record<string, unknown>)) {
        if (Array.isArray(messages)) {
          const first = messages.find((m): m is string => typeof m === 'string');
          if (first !== undefined) return { message: first };
        }
      }
    }
    if (typeof b.detail === 'string') return { message: b.detail };
    return { message: b.title };
  }

  return {};
}

/** Parse a raw response-text error body (XHR paths). Total — never throws. */
export function parseErrorText(text: string): ParsedApiError {
  try {
    return parseErrorBody(JSON.parse(text));
  } catch {
    return {};
  }
}

export function extractApiMessage(body: unknown): string | undefined {
  return parseErrorBody(body).message;
}

export function extractApiError(body: unknown): ParsedApiError {
  return parseErrorBody(body);
}
