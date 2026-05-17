import { createFileRoute } from '@tanstack/react-router';

import s from './profile.module.css';

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div className={s.page}>
      <h1 className={s.title}>Profile</h1>
      <p className={s.subtitle}>Coming in a later slice.</p>
      <div className={s.placeholder}>Profile editing lands with the Discover slice.</div>
    </div>
  );
}
