import { useState } from 'react';
import { setSfxEnabled, sfxEnabled } from '../lib/sfx';
import { setTheme, theme } from '../lib/theme';
import { setWikiImagesEnabled, wikiImagesEnabled } from '../lib/wikiImages';
import { WmSettingsRows } from './Wm';

// Settings as a screen: the game (sound, theme, missing images) and the way back to wiki-masters'
// own interface. The account itself is wiki-masters'.

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="setrow">
      <div className="t">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, labels }: { on: boolean; onChange: (v: boolean) => void; labels: [string, string] }) {
  return (
    <button className={`btn sm toggle${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      {on ? labels[0] : labels[1]}
    </button>
  );
}

export function SettingsScreen() {
  const [sound, setSound] = useState(sfxEnabled);
  const [light, setLight] = useState(() => theme() === 'light');
  const [wikiImages, setWikiImages] = useState(wikiImagesEnabled);
  return (
    <div className="screen">
      <section className="head narrowhead">
        <div className="headmain">
          <h1 className="h1">Réglages</h1>
        </div>
      </section>
      <div className="page narrowpage">
        <div className="card-box">
          <h2>Jeu</h2>
          <Row title="Son" sub="Effets sonores (paquets, cartes, boutons)">
            <Toggle on={sound} onChange={(v) => (setSfxEnabled(v), setSound(v))} labels={['Activé', 'Coupé']} />
          </Row>
          <Row title="Apparence" sub="Le décor des paquets reste de nuit.">
            <Toggle on={light} onChange={(v) => (setTheme(v ? 'light' : 'dark'), setLight(v))} labels={['Clair', 'Sombre']} />
          </Row>
          <Row title="Images manquantes" sub="Chercher une image sur Wikimedia Commons pour les cartes qui n’en ont pas (les titres sont envoyés à Wikipédia et Wikidata, sans cookie).">
            <Toggle on={wikiImages} onChange={(v) => (setWikiImagesEnabled(v), setWikiImages(v))} labels={['Activé', 'Désactivé']} />
          </Row>
        </div>
        <div className="card-box">
          <h2>wiki-masters</h2>
          <WmSettingsRows />
        </div>
      </div>
    </div>
  );
}
