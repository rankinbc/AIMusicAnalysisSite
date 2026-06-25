// app.jsx — full-page stage for the library redesign: a slim SPECTR top bar,
// the LibraryView, a Sonner-style toast host, and the Tweaks panel (prototype-
// only; explores badge style, version-strip shape, density, view). Tweaks are
// an exploration affordance — they don't ship.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "view": "grid",
  "badge": "icon",
  "strip": "dots",
  "peek": true,
  "cardMin": 304
}/*EDITMODE-END*/;

const VIS_DOT = { private: 'var(--muted)', shared: 'var(--cyan)', public: 'var(--violet)' };

function Topbar() {
  return (
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark" /> <b>SPECTR</b></a>
      <nav className="topnav">
        <a href="#" aria-current="page">Library</a>
        <a href="#">Reports</a>
        <a href="#">Coach</a>
        <a href="#">Profile</a>
      </nav>
      <div className="topbar-right">
        <span className="credits mono">credits <b>12</b></span>
        <span className="avatar" />
      </div>
    </header>
  );
}

function Toasts({ items }) {
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((t) => (
        <div className="toast" key={t.id} style={{ '--vis': t.vis ? VIS_DOT[t.vis] : 'var(--green)' }}>
          <span className="dot" />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [toasts, setToasts] = useState([]);

  const onToast = (msg, opts = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, vis: opts.vis }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  return (
    <div className="app">
      <Topbar />
      <LibraryView tweaks={tweaks} setTweak={setTweak} onToast={onToast} />
      <Toasts items={toasts} />

      <div className="tweakHint mono">
        <span className="kbd">Tweaks</span> in the toolbar → badge style · version strip · density
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="View" />
        <TweakRadio
          label="Layout" value={tweaks.view}
          options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]}
          onChange={(v) => setTweak('view', v)}
        />
        <TweakSlider label="Card width" value={tweaks.cardMin} min={264} max={372} step={4} unit="px" onChange={(v) => setTweak('cardMin', v)} />
        <TweakSection label="Card" />
        <TweakRadio
          label="Visibility badge" value={tweaks.badge}
          options={[{ value: 'icon', label: 'Icon' }, { value: 'label', label: 'Label' }, { value: 'marker', label: 'Marker' }]}
          onChange={(v) => setTweak('badge', v)}
        />
        <TweakRadio
          label="Version strip" value={tweaks.strip}
          options={[{ value: 'dots', label: 'Dots' }, { value: 'ticks', label: 'Ticks' }, { value: 'off', label: 'Off' }]}
          onChange={(v) => setTweak('strip', v)}
        />
        <TweakToggle label="Description peek" value={tweaks.peek} onChange={(v) => setTweak('peek', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
