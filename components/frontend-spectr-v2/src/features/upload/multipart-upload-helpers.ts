// Story 3.1 — pure logic for the presigned multipart upload path.
// Kept free of XHR/React so vitest covers part math, retry, and progress
// aggregation without a browser. The hook (useMixUpload) injects the real
// XHR `putPart`.

export interface PartPlan {
  partNumber: number; // 1-based, ascending (S3 requirement)
  start: number; // inclusive byte offset
  end: number; // exclusive byte offset — File.slice(start, end)
}

export interface CompletedPartInfo {
  partNumber: number;
  eTag: string;
}

// FOOTGUN #3 (R2): every part except the last must be the same size.
export function planParts(fileSize: number, partSize: number): PartPlan[] {
  if (fileSize <= 0 || partSize <= 0) return [];
  const plans: PartPlan[] = [];
  let start = 0;
  let n = 1;
  while (start < fileSize) {
    const end = Math.min(start + partSize, fileSize);
    plans.push({ partNumber: n, start, end });
    start = end;
    n += 1;
  }
  return plans;
}

// FR1: single 0..1 fraction across all parts, byte-accurate.
export function overallProgress(
  fileSize: number,
  completedBytes: number,
  inflightLoaded: number,
): number {
  if (fileSize <= 0) return 0;
  return Math.min(1, (completedBytes + inflightLoaded) / fileSize);
}

export type PutPart = (
  url: string,
  plan: PartPlan,
  onPartProgress: (loaded: number) => void,
) => Promise<string>; // resolves to the part's ETag

export interface UploadPartsOptions {
  plans: PartPlan[];
  urlByPart: ReadonlyMap<number, string>;
  fileSize: number;
  putPart: PutPart;
  onProgress?: (fraction: number) => void;
  // NFR3: a stalled/failed part retries in place — the upload never restarts
  // from zero (earlier parts' ETags are kept).
  maxAttemptsPerPart?: number;
  // Injectable for tests; default exponential-ish backoff.
  delay?: (attempt: number) => Promise<void>;
}

const defaultDelay = (attempt: number) =>
  new Promise<void>((r) => setTimeout(r, 500 * attempt));

export async function uploadPartsSequential(
  opts: UploadPartsOptions,
): Promise<CompletedPartInfo[]> {
  const {
    plans,
    urlByPart,
    fileSize,
    putPart,
    onProgress,
    maxAttemptsPerPart = 3,
    delay = defaultDelay,
  } = opts;

  const completed: CompletedPartInfo[] = [];
  let completedBytes = 0;

  for (const plan of plans) {
    const url = urlByPart.get(plan.partNumber);
    if (!url) throw new Error(`No presigned URL for part ${plan.partNumber}`);

    let lastError: unknown = null;
    let eTag: string | null = null;
    for (let attempt = 1; attempt <= maxAttemptsPerPart; attempt++) {
      try {
        eTag = await putPart(url, plan, (loaded) => {
          onProgress?.(overallProgress(fileSize, completedBytes, loaded));
        });
        break;
      } catch (e) {
        lastError = e;
        if (attempt < maxAttemptsPerPart) await delay(attempt);
      }
    }
    if (eTag === null) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`Part ${plan.partNumber} failed after ${maxAttemptsPerPart} attempts`);
    }

    completed.push({ partNumber: plan.partNumber, eTag });
    completedBytes += plan.end - plan.start;
    onProgress?.(overallProgress(fileSize, completedBytes, 0));
  }

  return completed;
}
