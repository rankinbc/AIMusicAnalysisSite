// app.jsx — neutral stage that hosts the modal, a Sonner-style toast, and the
// Tweaks panel (preview placement, modal width/density, disclosure mode).

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "place": "left",
  "width": 700,
  "density": "regular",
  "disclosure": "all"
}/*EDITMODE-END*/;

function Toast({ items }) {
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          <span className="dot" />
          <span>Created <b>“{t.name}”</b></span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [open, setOpen] = React.useState(true);
  const [openCount, setOpenCount] = React.useState(0); // remount → re-randomize visual
  const [toasts, setToasts] = React.useState([]);

  const openModal = () => { setOpenCount((c) => c + 1); setOpen(true); };
  const closeModal = () => setOpen(false);

  const handleCreated = (song) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, name: song.name }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
    setOpen(false);
  };

  return (
    <>
      <div className="stage">
        <button type="button" className="stage-open" onClick={openModal}>
          <span className="plus">+</span> New song
        </button>
        <span className="stage-hint mono">the create-song dialog, on a neutral stage</span>
      </div>

      {open && (
        <NewSongModal key={openCount} tweaks={tweaks} onClose={closeModal} onCreated={handleCreated} />
      )}

      <Toast items={toasts} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Layout" />
        <TweakRadio
          label="Preview"
          value={tweaks.place}
          options={[{ value: 'left', label: 'Left' }, { value: 'top', label: 'Top' }, { value: 'right', label: 'Right' }]}
          onChange={(v) => setTweak('place', v)}
        />
        <TweakRadio
          label="Fields"
          value={tweaks.disclosure}
          options={[{ value: 'all', label: 'All visible' }, { value: 'more', label: 'More options' }]}
          onChange={(v) => setTweak('disclosure', v)}
        />
        <TweakSection label="Size" />
        <TweakSlider label="Width" value={tweaks.width} min={600} max={860} step={20} unit="px" onChange={(v) => setTweak('width', v)} />
        <TweakRadio
          label="Density"
          value={tweaks.density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
