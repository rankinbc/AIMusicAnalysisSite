# SPECTR UI — how to build with this design system

SPECTR is a **dark-theme** music-producer UI. Components are the real shipped
React parts from `spectr-frontend-v2/src/ui`, imported from `window.SpectrUI.*`.

## Setup — this is a dark theme

Every component is designed to sit on the app's dark background. There is **no
theme provider and no wrapper component** — instead, mount your tree on the DS
surface and the tokens + fonts do the rest:

```jsx
<div style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }}>
  {/* your screen */}
</div>
```

`styles.css` (already loaded) sets the body to `--bg`, wires the two self-hosted
variable fonts — **Syne** (default UI font) and **JetBrains Mono** (numerals /
labels, via the `.mono` class) — and defines every token below. Light-on-light
breaks: never place these components on a white background.

## Styling idiom — global utility classes + CSS variable tokens

There is **no Tailwind**. Style with the DS's own global classes and `var(--*)`
tokens. The reusable classes (apply via `className`):

| Class | What it is |
|---|---|
| `.card`, `.card-hd`, `.card-body` (`.card-body.tight`) | panel container, header row, body |
| `.pill` + tone `.cyan` `.violet` `.orange` `.red` `.green` `.yellow` | status/metadata chip |
| `.dot` + tone `.violet` `.orange` `.red` (default cyan) | glowing status dot |
| `.btn` + `.primary` `.ghost` `.sm` `.violet` | buttons |
| `.label` | mono, letter-spaced, uppercase eyebrow |
| `.mono` | JetBrains Mono with tabular numerals — use for all numbers |

Token families (define colors/spacing in your own CSS via `var(--*)`):

- Surfaces: `--bg` `--bg-2` `--surface` `--card` `--card-hover` `--border` `--border-2`
- Accents: `--cyan` (brand) `--violet` `--orange` `--red` `--green` `--yellow` `--blue`
- Text: `--text` `--text-2` `--muted` `--dim`
- Radii / spacing: `--radius` `--radius-sm` `--radius-lg`, `--space-1`…`--space-6`
- Grades: `--grade-a` `--grade-b` `--grade-c` `--grade-d` `--grade-f`
- Severity: `--sev-critical` `--sev-severe` `--sev-moderate` `--sev-minor` `--sev-win`

Read `styles.css` and `tokens/tokens.css` before styling, and each component's
`.prompt.md` + `.d.ts` for its exact props.

## Components

Primitives: `BrandMark`, `Pill`, `Dot`, `Label`, `GradePill`. Mascots: `Coach`,
`CoachMini`, `SpecialistBot` (props `size`/`thinking`/`glow`). Song visuals:
`CoverArt`, `SongVisual` (templates: aurora/eq/vinyl/skyline/cassette/boombox/
spin + robot/booth), `SongVisualPicker`. Charts: `ProgressTimeline`, `VersionArc`
(version-score history).

## Idiomatic example

```jsx
<div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 'var(--space-6)' }}>
  <div className="card">
    <div className="card-hd">
      <span className="label">Mix score</span>
      <Pill tone="green" className="mono">release ready</Pill>
    </div>
    <div className="card-body" style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
      <GradePill grade="A" size="lg" />
      <div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>
          -9.2 <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>LUFS</span>
        </div>
        <Pill tone="cyan"><Dot tone="cyan" /> analyzing</Pill>
      </div>
    </div>
  </div>
</div>
```
