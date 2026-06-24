## Task 10 — Worklet boot fix: ?worker&url (2026-06-24)

### FIX

`registerWorklets` now imports each processor via `?worker&url`:

```ts
import gateProcessorUrl from './dsp/processors/gate.processor.ts?worker&url';
import bitcrusherProcessorUrl from './dsp/processors/bitcrusher.processor.ts?worker&url';
import limiterProcessorUrl from './dsp/processors/limiter.processor.ts?worker&url';
```

Each URL is passed directly to `ctx.audioWorklet.addModule(...)`. The `new URL('./x.ts', import.meta.url)` pattern is gone.

### DECODE-PROOF

Vite emitted three separate JS worklet chunks:

- `dist/assets/gate.processor-CAiUbsZW.js` (1.52 kB)
- `dist/assets/bitcrusher.processor-B18-Fiv2.js` (0.76 kB)
- `dist/assets/limiter.processor-CdwfFO0s.js` (1.61 kB)

Head of `gate.processor-CAiUbsZW.js` (decisive evidence):

```
(function(){"use strict";function c(e){return Math.pow(10,e/20)}function f(e,s){return
e<=0?1:1-Math.exp(-1/(e/1e3*s))}...registerProcessor("gate",g)})();
```

- `Math.pow(10,e/20)` — inlined `dbToLin` from `dbScale` (no bare `from '../dbScale'` import)
- `registerProcessor("gate",g)` — correctly registered
- `process(s,n,a){` — no `: Float32Array[][]` annotation
- No `private `, no `type ` imports — pure compiled JS

### Gate results

| Gate | Result |
|------|--------|
| `tsc -b` | CLEAN (exit 0) |
| `npm run build` | PASS (exit 0, 7.83s) |
| Decode-proof | COMPILED JS — `registerProcessor("gate",...)` + inlined math, zero TS syntax |
| `npx vitest run` | 432/432 passed (67 files) |
| `npm run lint` | CLEAN (exit 0, --max-warnings 0) |

### Commit

`fix(listen): load worklet processors via ?worker&url (transpiled+bundled, not raw TS)`
