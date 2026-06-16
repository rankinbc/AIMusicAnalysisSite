import * as Tabs from '@radix-ui/react-tabs';
import type { RailTab } from './tabRegistry';
import s from './RightRail.module.css';

interface Props {
  tabs: RailTab[];
  defaultTab?: string;
}

export function RightRail({ tabs, defaultTab }: Props) {
  const first = defaultTab ?? tabs[0]?.id;
  return (
    <Tabs.Root defaultValue={first} className={s.root}>
      <Tabs.List className={s.list} aria-label="Listen panels">
        {tabs.map((t) => (
          <Tabs.Trigger key={t.id} value={t.id} className={s.trigger}>
            <span className={s.icon} aria-hidden="true">{t.icon}</span>
            <span className={s.label}>{t.label}</span>
            {t.badge ? <span className={s.badge}>{t.badge}</span> : null}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t.id} value={t.id} className={s.content}>
          {t.render()}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
