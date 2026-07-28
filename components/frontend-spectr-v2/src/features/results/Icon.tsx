import type { ReactElement } from 'react';

// Canonical icon set for the v3 results redesign — ported verbatim from the
// design prototype's `ar-ui.jsx` Icon (stroke 1.7, rounded). Every results
// surface renders through this one component so glyphs stay identical to the
// handoff. Add a name here rather than reaching for a text glyph.
export type IconName =
  | 'back'
  | 'arrow'
  | 'play'
  | 'pause'
  | 'plus'
  | 'minus'
  | 'filter'
  | 'check'
  | 'x'
  | 'flag'
  | 'target'
  | 'chart'
  | 'diamond'
  | 'sliders'
  | 'layers'
  | 'sparkle'
  | 'users'
  | 'refresh'
  | 'download'
  | 'send'
  | 'dots'
  | 'anchor'
  | 'eye'
  | 'eyeoff'
  | 'thumbup'
  | 'thumbdown'
  | 'alert'
  | 'clock'
  | 'copy'
  | 'chevron'
  | 'folder'
  | 'file'
  | 'bolt'
  | 'vinyl'
  | 'cassette'
  | 'wrench'
  | 'zoom'
  | 'info'
  | 'wave'
  | 'collision'
  | 'music'
  | 'pulse'
  | 'spatial'
  | 'save'
  | 'sound'
  | 'message'
  | 'external'
  | 'robot'
  | 'phone'
  | 'laptop'
  | 'headphones';

const PATHS: Record<IconName, ReactElement> = {
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  play: <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  check: <path d="M5 13l4 4L19 7" />,
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V5" />
      <rect x="7" y="11" width="3" height="8" rx="1" />
      <rect x="13" y="7" width="3" height="12" rx="1" />
    </>
  ),
  diamond: <path d="M12 3l7 9-7 9-7-9z" />,
  sliders: (
    <>
      <path d="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3" />
      <circle cx="4" cy="13" r="1.6" />
      <circle cx="12" cy="10" r="1.6" />
      <circle cx="20" cy="15" r="1.6" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  sparkle: <path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8z" fill="currentColor" stroke="none" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.4 19.2a5.6 5.6 0 0 1 11.2 0" />
      <path d="M16.2 5.3a3.2 3.2 0 0 1 0 5.5" />
      <path d="M17.8 19.2a5.6 5.6 0 0 0-3-5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  send: <path d="M5 12l15-7-7 15-2-6z" />,
  dots: (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 22V8" />
      <path d="M5 12a7 7 0 0 0 14 0" />
      <path d="M3 12h2M19 12h2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeoff: (
    <>
      <path d="M17.9 17.9A10.5 10.5 0 0 1 12 19c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.1-5.1M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.2 3.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </>
  ),
  thumbup: (
    <>
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3z" />
      <path d="M7 10l4.2-7a2 2 0 0 1 3.6 1.2L14 8h5a2 2 0 0 1 2 2.4l-1.4 8A2 2 0 0 1 17.6 20H7" />
    </>
  ),
  thumbdown: (
    <>
      <path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3z" />
      <path d="M17 14l-4.2 7a2 2 0 0 1-3.6-1.2L10 16H5a2 2 0 0 1-2-2.4l1.4-8A2 2 0 0 1 6.4 4H17" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  folder: <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
  file: (
    <>
      <path d="M14 3v5h5" />
      <path d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </>
  ),
  bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6z" />,
  vinyl: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.4" opacity="0.4" />
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="12" cy="12" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  cassette: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
      <circle cx="9" cy="12.5" r="2" />
      <circle cx="15" cy="12.5" r="2" />
      <path d="M7.4 18.5l1.3-3h6.6l1.3 3" />
    </>
  ),
  wrench: <path d="M14.5 5.5a4 4 0 0 0-5.3 5.1L4 16l2 2 5.4-5.2a4 4 0 0 0 5.1-5.3l-2.3 2.3-2.1-.6-.6-2.1z" />,
  zoom: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M11 8v6M8 11h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  wave: <path d="M3 12h2l2-6 3 13 3-16 2 9 2-4h4" />,
  collision: (
    <>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  music: (
    <>
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="17" cy="16" r="2.6" />
      <path d="M8.6 18V6l11-2v10" />
    </>
  ),
  pulse: <path d="M3 12h4l2-6 4 14 2-8h6" />,
  spatial: (
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4" />
      <rect x="8" y="13" width="8" height="6" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </>
  ),
  message: <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ),
  robot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 4.6V8" />
      <circle cx="12" cy="3.5" r="1.3" fill="currentColor" stroke="none" />
      <path d="M9.5 13h.01M14.5 13h.01" />
      <path d="M3 12.5v2.5M21 12.5v2.5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M10.5 18h3" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 20h20" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 14v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="14" width="4.5" height="6" rx="1.8" />
      <rect x="16.5" y="14" width="4.5" height="6" rx="1.8" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 15 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
