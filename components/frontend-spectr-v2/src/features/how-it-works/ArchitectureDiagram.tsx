// "Under the hood": the production system behind the pipeline. Every box is
// verified against the deploy config — infra/compose.prod.yml (caddy
// spectr-web image serving the SPA, bff, worker-paid WORKER_QUEUES="coach",
// worker-free = analysis + maintenance, postgres:16, redis:7 AOF, R2 via the
// S3 API, prometheus + grafana), components/bff (UploadEndpoints.cs presigned
// direct-to-R2 multipart), components/worker/app/llm/gateway.py + budget.py
// (single Anthropic touchpoint, per-tier monthly ceilings, one llm_calls row
// per call), .github/workflows/ci.yml + infra/deploy.sh (gitleaks, tests,
// Trivy on built images, Azure OIDC, SSH deploy, /healthz with auto-rollback).
import { Box, DiagramSvg, Edge } from './diagram-kit';
import type { BoxSpec, EdgeSpec } from './diagram-kit';
import s from './diagram.module.css';

export const ARCH_TITLE = 'SPECTR system architecture';
export const ARCH_DESC =
  'The browser runs a React 19 single-page app served by Caddy over HTTPS; Caddy forwards API calls to an ' +
  'ASP.NET Core (.NET 10) backend-for-frontend that handles auth and the API and signs upload URLs, so ' +
  'audio goes straight from the browser to Cloudflare R2 object storage. The backend writes to PostgreSQL 16 ' +
  'and enqueues jobs on Redis 7 with Dramatiq. Python workers, in separate coach and analysis pools, read ' +
  'the audio from object storage, run the analysis and write results to PostgreSQL; their one LLM gateway ' +
  'enforces spend caps, meters every call and sends derived text, never audio, to Anthropic Claude.';

interface ArchLayout {
  width: number;
  height: number;
  boxes: readonly BoxSpec[];
  edges: readonly EdgeSpec[];
}

const WIDE: ArchLayout = {
  width: 720,
  height: 400,
  boxes: [
    { id: 'browser', x: 0, y: 8, w: 200, h: 66, tone: 'orange', title: 'Browser', lines: ['React 19 · TypeScript SPA', 'Web Audio Listen rack'] },
    { id: 'caddy', x: 260, y: 8, w: 200, h: 66, tone: 'neutral', title: 'Caddy', lines: ['HTTPS edge · serves the SPA', 'the only public ingress'] },
    { id: 'bff', x: 520, y: 8, w: 200, h: 66, tone: 'blue', title: 'ASP.NET Core BFF', lines: ['.NET 10 · EF Core · JWT', 'auth · API · upload signing'] },
    { id: 'r2', x: 0, y: 130, w: 200, h: 66, tone: 'green', title: 'Object storage', lines: ['Cloudflare R2 (S3 API)', 'audio · stems · projects'] },
    { id: 'redis', x: 260, y: 130, w: 200, h: 66, tone: 'yellow', title: 'Redis 7 + Dramatiq', lines: ['durable job queues', 'coach lane · analysis lane'] },
    { id: 'pg', x: 520, y: 130, w: 200, h: 66, tone: 'green', title: 'PostgreSQL 16', lines: ['users · analyses · findings', 'EF Core migrations'] },
    { id: 'workers', x: 0, y: 246, w: 460, h: 134, tone: 'cyan', title: 'Python workers · one image, two pools', variant: 'group' },
    { id: 'w-analysis', x: 12, y: 272, w: 212, h: 58, tone: 'cyan', title: 'Analysis worker', lines: ['librosa · pyloudnorm · NumPy', 'rules · triage · specialists'] },
    { id: 'w-coach', x: 236, y: 272, w: 212, h: 58, tone: 'cyan', title: 'Coach worker', lines: ['chat only, so a reply never', 'waits behind an analysis'] },
    { id: 'gateway', x: 12, y: 343, w: 436, h: 28, tone: 'violet', title: 'LLM gateway · per-tier spend caps · every call metered · retries', variant: 'strip' },
    { id: 'claude', x: 520, y: 322, w: 200, h: 70, tone: 'violet', title: 'Anthropic Claude', lines: ['triage · specialists · coach', 'derived text only, no audio'] },
  ],
  edges: [
    { pts: [[200, 41], [260, 41]] },
    { pts: [[460, 41], [520, 41]], label: { x: 490, y: 35, text: '/api', anchor: 'middle' } },
    { pts: [[100, 74], [100, 130]], label: { x: 106, y: 106, text: 'presigned upload' } },
    { pts: [[620, 74], [620, 130]] },
    { pts: [[560, 74], [560, 102], [360, 102], [360, 130]], label: { x: 366, y: 96, text: 'enqueue' } },
    { pts: [[100, 196], [100, 246]], label: { x: 106, y: 226, text: 'audio' } },
    { pts: [[360, 196], [360, 246]], label: { x: 366, y: 226, text: 'jobs' } },
    { pts: [[460, 290], [490, 290], [490, 163], [520, 163]], label: { x: 496, y: 230, text: 'results' } },
    { pts: [[448, 357], [520, 357]] },
  ],
};

const NARROW: ArchLayout = {
  width: 360,
  height: 622,
  boxes: [
    { id: 'browser', x: 0, y: 0, w: 150, h: 62, tone: 'orange', title: 'Browser', lines: ['React 19 SPA', 'Web Audio rack'] },
    { id: 'r2', x: 190, y: 0, w: 150, h: 62, tone: 'green', title: 'Object storage', lines: ['Cloudflare R2', 'S3 API'] },
    { id: 'caddy', x: 0, y: 96, w: 150, h: 62, tone: 'neutral', title: 'Caddy', lines: ['HTTPS edge', 'serves the SPA'] },
    { id: 'bff', x: 0, y: 192, w: 150, h: 62, tone: 'blue', title: 'ASP.NET Core BFF', lines: ['.NET 10 · EF Core', 'auth · API · signing'] },
    { id: 'pg', x: 190, y: 192, w: 150, h: 62, tone: 'green', title: 'PostgreSQL 16', lines: ['users · analyses', 'findings'] },
    { id: 'redis', x: 0, y: 288, w: 150, h: 62, tone: 'yellow', title: 'Redis + Dramatiq', lines: ['durable job queues', 'coach · analysis'] },
    { id: 'workers', x: 0, y: 384, w: 340, h: 140, tone: 'cyan', title: 'Python workers · two pools', variant: 'group' },
    { id: 'w-analysis', x: 10, y: 410, w: 155, h: 58, tone: 'cyan', title: 'Analysis worker', lines: ['librosa · pyloudnorm', 'rules · AI'] },
    { id: 'w-coach', x: 175, y: 410, w: 155, h: 58, tone: 'cyan', title: 'Coach worker', lines: ['chat only, never', 'behind an analysis'] },
    { id: 'gateway', x: 10, y: 480, w: 320, h: 28, tone: 'violet', title: 'LLM gateway · spend caps · metered', variant: 'strip' },
    { id: 'claude', x: 0, y: 556, w: 340, h: 62, tone: 'violet', title: 'Anthropic Claude', lines: ['triage · specialists · coach', 'gets derived text, never audio'] },
  ],
  edges: [
    { pts: [[150, 31], [190, 31]], label: { x: 170, y: 25, text: 'upload', anchor: 'middle' } },
    { pts: [[75, 62], [75, 96]] },
    { pts: [[75, 158], [75, 192]] },
    { pts: [[150, 223], [190, 223]] },
    { pts: [[75, 254], [75, 288]] },
    { pts: [[75, 350], [75, 384]], label: { x: 81, y: 372, text: 'jobs' } },
    { pts: [[265, 384], [265, 254]], label: { x: 271, y: 322, text: 'results' } },
    { pts: [[340, 31], [352, 31], [352, 440], [342, 440]], label: { x: 346, y: 130, text: 'audio', anchor: 'end' } },
    { pts: [[170, 524], [170, 556]] },
  ],
};

function ArchSvg({ layout, className }: { layout: ArchLayout; className: string }) {
  return (
    <DiagramSvg width={layout.width} height={layout.height} title={ARCH_TITLE} desc={ARCH_DESC} className={className}>
      {(marker) => (
        <>
          {layout.edges.map((e, i) => (
            <Edge key={i} e={e} marker={marker} />
          ))}
          {layout.boxes.map((b) => (
            <Box key={b.id} b={b} />
          ))}
        </>
      )}
    </DiagramSvg>
  );
}

export const DEPLOY_CHAIN = [
  'Push',
  'Secret scan · tests · lint · type-check',
  'Build images',
  'Trivy vulnerability scan',
  'Azure login via OIDC',
  'Docker Compose on an Azure VM',
  '/healthz check · auto-rollback',
] as const;

export const REPO_URL = 'https://github.com/rankinbc/AIMusicAnalysisSite';

export function ArchitectureDiagram() {
  return (
    <figure className={s.figure} data-testid="architecture-diagram">
      <ArchSvg layout={WIDE} className={s.layoutWide} />
      <ArchSvg layout={NARROW} className={s.layoutNarrow} />
      <figcaption className={s.caption}>
        Signed-in uploads go straight from the browser to object storage on presigned URLs, so the API
        server never relays the audio. Chat and analysis run in separate worker pools, and every LLM call
        passes through one gateway that enforces monthly spend ceilings and records its cost.
      </figcaption>
      <div>
        <span className="label">Ship it</span>
        <ol className={s.chain} aria-label="Deploy pipeline">
          {DEPLOY_CHAIN.map((step) => (
            <li key={step} className={s.chainStep}>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className={s.repo}>
        Metrics in Prometheus and Grafana. The source is public:{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          github.com/rankinbc/AIMusicAnalysisSite
        </a>
        .
      </p>
    </figure>
  );
}
