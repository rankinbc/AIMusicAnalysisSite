import { Outlet, createFileRoute } from '@tanstack/react-router';

import s from './_public/_publicLayout.module.css';

// Anonymous layout: login, register, share-link reviewer pages at /r/$token.
// No Topnav / no auth guard. Centers a narrow column with the SPECTR
// wordmark sitting above the routed content.

export const Route = createFileRoute('/_public')({
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <div className={s.shell}>
      <div className={s.column}>
        <div className={s.brand}>
          SPEC<span className={s.brandAccent}>TR</span>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
