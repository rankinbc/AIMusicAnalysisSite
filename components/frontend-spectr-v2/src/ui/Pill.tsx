import type { CSSProperties, ReactNode } from 'react';

export type PillTone = 'default' | 'cyan' | 'violet' | 'orange' | 'red' | 'green' | 'yellow';

interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Pill({ tone = 'default', children, className, style, title }: PillProps) {
  const toneClass: string = tone === 'default' ? '' : ` ${tone}`;
  return (
    <span className={`pill${toneClass}${className ? ` ${className}` : ''}`} style={style} title={title}>
      {children}
    </span>
  );
}

interface DotProps {
  tone?: 'cyan' | 'violet' | 'orange' | 'red';
  className?: string;
  style?: CSSProperties;
}

export function Dot({ tone = 'cyan', className, style }: DotProps) {
  const toneClass = tone === 'cyan' ? '' : ` ${tone}`;
  return <span className={`dot${toneClass}${className ? ` ${className}` : ''}`} style={style} />;
}

interface LabelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Label({ children, className, style }: LabelProps) {
  return (
    <div className={`label${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  );
}
