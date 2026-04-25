# frontend

**Purpose**: React 19 + Vite 8 + TypeScript SPA. Auth screens (register/login). Upload page with drag-and-drop file picker (MP3/FLAC/WAV up to 200 MB), optional reference track upload, upload progress bar. Job progress page with SSE-driven 7-phase display (phase name + percentage per phase, animated). Interactive report page with: overall mix score (A-F grade), top 3 priority fixes, genre badge (with override option), streaming readiness table (Spotify/Apple Music/YouTube LUFS targets with pass/fail), 7-band frequency balance bar chart, stereo analysis gauges, stem clash report table, reference comparison delta table (if reference was uploaded), genre profile percentile radar chart, arrangement advisor ordered fix list, expandable full breakdown sections.

**Inputs**: None (self-contained — calls the api component via REST + SSE at `/api/*`)

**Outputs**: None (renders in browser)

**Pattern**: `dashboard.md` (adapted to React/Vite SPA stack)

**Stack**: React 19, Vite 8, TypeScript 5, Tailwind CSS v3, shadcn/ui, Recharts, Axios, React Router v7

## How to run

```bash
cd components/frontend
npm install
npm run dev
# Opens at http://localhost:5173
# API calls proxy to http://localhost:8000 (requires api component running)
```

To type-check without running:
```bash
npm run type-check
```

## Structure

```
components/frontend/
├── README.md                         # This file
├── package.json                      # Dependencies (React 19, Vite 8, Tailwind, etc.)
├── vite.config.ts                    # Dev server + /api proxy to localhost:8000
├── tsconfig.json                     # TypeScript config with @/ path alias
├── tailwind.config.ts                # Tailwind config with grade-color safelist
├── postcss.config.js                 # Autoprefixer
├── index.html                        # Vite entry point
├── tests/                            # Empty — /execute-prp writes tests alongside impl
└── src/
    ├── main.tsx                      # ReactDOM.createRoot
    ├── App.tsx                       # BrowserRouter + route tree + ProtectedLayout
    ├── index.css                     # Tailwind directives
    ├── types/
    │   └── api.ts                    # TypeScript interfaces for all API response shapes
    ├── lib/
    │   └── apiClient.ts              # Axios instance + dual interceptors (Bearer + refresh)
    ├── contexts/
    │   └── AuthContext.tsx           # Access token in React state (NOT localStorage)
    ├── components/ui/
    │   └── ProtectedLayout.tsx       # React Router Outlet-based auth guard
    └── features/
        ├── auth/
        │   ├── Login.tsx             # Login form
        │   ├── Register.tsx          # Registration form
        │   └── useAuth.ts            # Re-export of useAuth hook
        ├── upload/
        │   ├── UploadPage.tsx        # Drag-and-drop upload UI
        │   └── useFileUpload.ts      # XHR upload hook with progress events
        ├── analysis/
        │   ├── JobProgressPage.tsx   # 7-phase SSE progress display
        │   └── useJobStream.ts       # EventSource hook for SSE job events
        └── report/
            ├── ReportPage.tsx        # Report layout — fetches data, renders sub-components
            ├── MixScore.tsx          # A-F grade + RadialBar score + priority fixes
            ├── StreamingReadiness.tsx # LUFS pass/fail table (Spotify/Apple/YouTube)
            ├── FrequencyChart.tsx    # 7-band BarChart
            ├── StemClash.tsx         # Stem clash table
            ├── ReferenceComparison.tsx # Delta table (conditional on reference upload)
            ├── GenreRadar.tsx        # Genre percentile RadarChart
            └── ArrangementAdvisor.tsx # Ordered fix list
```

---

**To extend this component**: edit `PRPs/source/INITIAL.md` and run `/generate-prp`. Don't modify files here directly for new work — let the PRP drive it.
