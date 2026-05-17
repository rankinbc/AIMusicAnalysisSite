import type { CSSProperties, ReactNode } from 'react';

type CoverSize = 'sm' | 'md' | 'lg' | 'fluid';

interface CoverArtProps {
  hue?: number;
  size?: CoverSize;
  children?: ReactNode;
  ratio?: number;
  className?: string;
  style?: CSSProperties;
}

const sizePx: Record<Exclude<CoverSize, 'fluid'>, number> = {
  sm: 36,
  md: 56,
  lg: 240,
};

export function CoverArt({
  hue = 168,
  size = 'md',
  children,
  ratio,
  className,
  style,
}: CoverArtProps) {
  const fluid = size === 'fluid';
  const px = fluid ? undefined : sizePx[size];
  return (
    <div
      className={className}
      style={{
        width: fluid ? '100%' : px,
        height: fluid && ratio ? undefined : fluid ? '100%' : px,
        aspectRatio: fluid && ratio ? `${ratio}` : undefined,
        borderRadius: size === 'lg' ? 14 : size === 'sm' ? 6 : 8,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        background: `
          radial-gradient(ellipse 80% 60% at 30% 30%, oklch(0.72 0.18 ${hue} / 0.7) 0%, transparent 55%),
          radial-gradient(ellipse 70% 80% at 80% 70%, oklch(0.55 0.20 ${(hue + 60) % 360} / 0.55) 0%, transparent 60%),
          linear-gradient(135deg, oklch(0.22 0.04 ${hue}) 0%, oklch(0.14 0.04 ${(hue + 30) % 360}) 100%)
        `,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), 0 4px 14px -6px rgba(0,0,0,0.6)',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 4px)',
          opacity: 0.4,
          pointerEvents: 'none',
        }}
      />
      {children}
    </div>
  );
}
