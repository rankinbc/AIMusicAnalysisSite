import { useState } from 'react';

import s from './RawTab.module.css';

interface RawTabProps {
  rawJson: unknown;
}

export function RawTab({ rawJson }: RawTabProps) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(rawJson, null, 2);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className="label">Analysis JSON</span>
        <button type="button" className="btn sm" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className={s.code}>{text}</pre>
    </div>
  );
}
