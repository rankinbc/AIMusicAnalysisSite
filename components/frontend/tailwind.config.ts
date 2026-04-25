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
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

export default config
