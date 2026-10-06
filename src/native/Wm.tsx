import { openOriginal, showOriginalSite } from '../ext/bridge';

// The extension's own pieces: the official-site row in the settings and the signed-out screen.

export function WmSettingsRows() {
  return (
    <div className="setrow">
      <div className="t">
        <b>Site officiel wiki-masters</b>
        <span>Revenir à leur interface (Wikimasters Enhanced se réactive depuis leur page)</span>
      </div>
      <button className="btn sm toggle" onClick={showOriginalSite}>
        Afficher
      </button>
    </div>
  );
}

/** Not signed in on wiki-masters: sign in there first (their page, their form). */
export function WmSignedOut() {
  return (
    <div className="center">
      <div className="card-form" style={{ textAlign: 'center' }}>
        <div className="logo">Wikimasters Enhanced</div>
        <p className="muted">Connectez-vous d’abord sur wiki-masters.com : Wikimasters Enhanced joue avec votre compte wiki-masters, sur leurs serveurs.</p>
        <button className="btn primary big" onClick={() => openOriginal('/login')}>
          <span>
            Se connecter
            <span className="sub">Sur wiki-masters.com</span>
          </span>
        </button>
      </div>
    </div>
  );
}
