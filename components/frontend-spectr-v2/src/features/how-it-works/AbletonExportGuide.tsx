// "Optimal Ableton export instructions" — a link on the Upload step that opens
// a modal with how to export the mix, the stems and the project from Ableton
// Live so SPECTR gets the cleanest input. Radix Dialog gives the focus trap,
// Esc-to-close and labelled title (same as the app's other dialogs).
import * as Dialog from '@radix-ui/react-dialog';

import f from '../../styles/forms.module.css';
import { ABLETON_GUIDE } from './ableton-guide-content';
import s from './ableton-guide.module.css';

export function AbletonExportGuide() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className={s.trigger} data-testid="ableton-guide-link">
          Optimal Ableton export instructions
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={`${f.dialogContent} ${s.content}`}>
          <Dialog.Title className={f.dialogTitle}>Optimal Ableton export instructions</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Three exports give SPECTR the full picture: the mix, the stems and the project file. Use
            the same settings, and the same start and end, for all of them.
          </Dialog.Description>

          <div className={s.sections}>
            {ABLETON_GUIDE.map((sec) => (
              <section key={sec.title} className={s.guideSection}>
                <h3 className={s.guideTitle}>{sec.title}</h3>
                <ol className={s.guideSteps}>
                  {sec.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {sec.why && <p className={s.guideWhy}>{sec.why}</p>}
              </section>
            ))}
          </div>

          <p className={s.guideFoot}>
            No stems or project? The mix alone is enough to start.
          </p>
          <div className={f.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={f.button}>Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
