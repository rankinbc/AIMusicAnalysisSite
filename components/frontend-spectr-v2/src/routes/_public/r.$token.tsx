import { createFileRoute } from '@tanstack/react-router';

import s from './auth.module.css';

// Anonymous share-link reviewer page. WaveSurfer + timestamp-pin comments.
// /r/$token

export const Route = createFileRoute('/_public/r/$token')({
  component: SharedReviewerPage,
});

function SharedReviewerPage() {
  const { token } = Route.useParams();
  return (
    <div className={s.placeholder}>
      <h1 className={s.placeholderTitle}>Share-link reviewer</h1>
      <p className={`mono ${s.placeholderMeta}`}>Token: {token}</p>
    </div>
  );
}
