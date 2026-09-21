// Task P4 (public-surfaces-polish, §3.2) — semantic HTML/CSS only, no
// diagram runtime. Five nodes matching README.md's mermaid flowchart
// (Architecture section): SPA -> BFF -> Postgres/Redis -> Python worker ->
// LLM provider. An <ol> inside <figure>/<figcaption> so the request path
// reads correctly to a screen reader; CSS handles the column-at-390px /
// row-at-720px layout (engineering.module.css).
import s from './engineering.module.css';

interface DiagramNode {
  name: string;
  role: string;
}

const NODES: readonly DiagramNode[] = [
  { name: 'Browser', role: 'React SPA — talks only to the BFF, over REST and SSE' },
  {
    name: 'BFF',
    role: "ASP.NET Core — auth, uploads, entitlements, audio streaming; writes jobs directly onto Redis in the worker's own wire format",
  },
  { name: 'PostgreSQL + Redis', role: 'Redis carries the job queue; PostgreSQL holds everything durable' },
  { name: 'Python worker', role: 'dramatiq consumer — runs the audio pipeline, the rule engine, and LLM calls' },
  { name: 'LLM provider', role: 'Anthropic API — called by the worker for coach replies and specialist verdicts' },
];

export function ArchitectureDiagram() {
  return (
    <figure className={s.diagramFigure}>
      <figcaption className="label">Request path</figcaption>
      <ol className={s.diagram} aria-label="Request path">
        {NODES.map((node) => (
          <li key={node.name} className={s.diagramNode}>
            <span className={s.diagramName}>{node.name}</span>
            <span className={s.diagramRole}>{node.role}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
