import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  safelist: [
    // Grade letter colors (A=green → F=red) — computed at runtime from grade string
    'text-green-400', 'text-lime-400', 'text-yellow-400', 'text-orange-400', 'text-red-400',
    // Grade background colors
    'bg-green-900/30', 'bg-lime-900/30', 'bg-yellow-900/30', 'bg-orange-900/30', 'bg-red-900/30',
    // Streaming readiness pass/fail badges
    'bg-green-900', 'text-green-300',
    'bg-red-900', 'text-red-300',
    // Stem clash severity badges
    'bg-orange-900', 'text-orange-300',
    'bg-yellow-900', 'text-yellow-300',
    // Phase progress animation
    'animate-pulse',
    // Misc dynamic states
    'border-purple-500', 'bg-purple-900/20',
    'border-green-700', 'bg-green-900/10',
    // Fix card grade border colors
    'border-green-500', 'border-lime-500', 'border-yellow-500', 'border-orange-500', 'border-red-500',
    // Studio theme utilities
    'bg-studio-bg', 'bg-studio-surface', 'bg-studio-card', 'border-studio-border',
    'text-studio-amber', 'text-studio-sky', 'text-studio-muted',
    'font-display', 'font-metric',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        metric: ['"JetBrains Mono"', '"Fira Mono"', 'monospace'],
      },
      colors: {
        studio: {
          bg: '#07070f',
          surface: '#0e0e1c',
          card: '#111120',
          border: '#1c1c38',
          muted: '#6b6b9a',
          amber: '#f59e0b',
          sky: '#38bdf8',
        },
      },
    },
  },
  plugins: [],
}

export default config
