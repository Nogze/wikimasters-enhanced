import { Canvas, useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { startAccount } from '../lib/account';
import { useSession } from '../lib/auth';
import { navigate, usePath } from '../lib/router';
import { CardCloud } from '../three/CardCloud';
import { IDLE_TINT, makeStageFx, StageBackdrop, StageEffects, type StageFx } from '../three/Summon';
import { BoosterScreen } from './Booster';
import { CardLayer } from './CardLayer';
import { CollectionScreen } from './Collection';
import { MarketScreen } from './Market';
import { Dock, SubNav, TitleScreen, TopBar, useBadges } from './Shell';
import { AchievementsScreen, HomeScreen, LeaderboardScreen } from './Progress';
import { CatalogScreen, PlayerScreen, ProfileScreen } from './Profile';
import { FriendsScreen, MessagesScreen } from './Social';
import { GuildScreen } from './Guild';
import { BattleArena, BattlesScreen } from './Battle';
import { SettingsScreen } from './Settings';
import { screenOf, TITLES, type ScreenId } from './nav';
import { TradesScreen } from './Trades';
import { World } from './tunnel';
import { WmSignedOut } from './Wm';

// The native client, three layers deep:
//  - the world canvas (z 0): the summoning stage, the title's card cloud and the pack opening;
//    shown on the title and booster screens only, paused elsewhere;
//  - the interface (z 1): plain HTML, every screen, bar and button;
//  - the card layer (z 2): the 3D cards of the interface, each pinned to its HTML slot.
// Dialogs and toasts sit above all three (kit.tsx).

const BOOT_KEY = 'wme-booted';

const CAMERA: Record<'title' | 'booster', { pos: [number, number, number]; look: [number, number, number] }> = {
  title: { pos: [0, 2.6, 8.4], look: [0, 0.4, -2] },
  booster: { pos: [0, 0.55, 6.6], look: [0, 0.05, 0] },
};

/** Camera per screen (eased flights between them), plus shake / push-in / lift from the stage fx. */
function Director({ view, fx }: { view: 'title' | 'booster'; fx: StageFx }) {
  const { camera } = useThree();
  const rig = useMemo(() => ({ pos: new THREE.Vector3(0, 7, 12), look: new THREE.Vector3(0, 0, 0) }), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const c = CAMERA[view];
    const tl = gsap.timeline();
    tl.to(rig.pos, { x: c.pos[0], y: c.pos[1], z: c.pos[2], duration: 1.4, ease: 'power3.inOut' }, 0).to(rig.look, { x: c.look[0], y: c.look[1], z: c.look[2], duration: 1.4, ease: 'power3.inOut' }, 0);
    return () => {
      tl.kill();
    };
  }, [view, rig]);
  useFrame(({ clock }) => {
    const s = fx.shake * 0.06;
    const t = clock.elapsedTime * 60;
    camera.position.set(rig.pos.x + Math.sin(t * 1.3) * s, rig.pos.y + Math.cos(t * 1.7) * s - fx.zoom * 0.06 + fx.lift, rig.pos.z - fx.zoom);
    look.set(rig.look.x, rig.look.y + fx.lift * 1.3, rig.look.z);
    camera.lookAt(look);
    camera.rotateZ(Math.sin(t * 0.9) * s * 0.35);
  });
  return null;
}

function WorldScene({ view, fx }: { view: 'title' | 'booster'; fx: StageFx }) {
  // Back to the idle stage between openings (the booster scene drives it while it's up).
  useEffect(() => {
    const tint = new THREE.Color(IDLE_TINT);
    gsap.to(fx, { pillar: 0, rays: view === 'title' ? 0.2 : 0.12, power: 0.3, spin: 0.12, rainbow: 0, orb: 0, duration: 0.8 });
    gsap.to(fx.tint, { r: tint.r, g: tint.g, b: tint.b, duration: 0.8 });
  }, [view, fx]);
  return (
    <>
      <StageBackdrop fx={fx} />
      {view === 'title' && <CardCloud />}
      <Director view={view} fx={fx} />
      <World.Out />
      <StageEffects fx={fx} />
    </>
  );
}

export function NativeApp() {
  const session = useSession();
  const path = usePath();
  const [booted, setBooted] = useState(() => {
    try {
      return sessionStorage.getItem(BOOT_KEY) === '1';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (session) startAccount(session.user.id);
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = screenOf(path);
  useEffect(() => {
    if (!target) navigate('/', { replace: true });
    else document.title = `${TITLES[target]} — Wikimasters Enhanced`;
  }, [path, target]);
  const stage = useMemo(() => {
    const s = makeStageFx();
    s.orb = 0;
    return s;
  }, []);

  const screen: ScreenId | 'title' = !session || !booted ? 'title' : (target ?? 'booster');
  const inWorld = screen === 'title' || screen === 'booster';
  const badges = useBadges(session && booted ? session.user.id : null);
  const boot = () => {
    try {
      sessionStorage.setItem(BOOT_KEY, '1');
    } catch {
      /* private mode */
    }
    setBooted(true);
  };

  let body: React.ReactNode;
  if (session === undefined) body = <div className="center muted">Chargement…</div>;
  else if (!session) body = <WmSignedOut />;
  else if (!booted) body = <TitleScreen onStart={boot} />;
  else
    body = (
      <>
        <TopBar />
        {screen !== 'title' && <SubNav screen={screen} />}
        {screen === 'booster' && <BoosterScreen stage={stage} />}
        {screen === 'battles' && <BattlesScreen />}
        {screen === 'battle' && <BattleArena key={path} id={path.slice('/battle/'.length)} />}
        {screen === 'home' && <HomeScreen />}
        {screen === 'collection' && <CollectionScreen />}
        {screen === 'catalog' && <CatalogScreen />}
        {screen === 'profile' && <ProfileScreen />}
        {screen === 'player' && <PlayerScreen username={decodeURIComponent(path.slice('/profile/'.length))} />}
        {screen === 'market' && <MarketScreen path={path} />}
        {screen === 'trades' && <TradesScreen />}
        {screen === 'friends' && <FriendsScreen />}
        {screen === 'dms' && <MessagesScreen />}
        {screen === 'guild' && <GuildScreen />}
        {screen === 'achievements' && <AchievementsScreen />}
        {screen === 'leaderboard' && <LeaderboardScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen !== 'title' && <Dock screen={screen} path={path} badges={badges} />}
      </>
    );

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#02030a', visibility: inWorld ? 'visible' : 'hidden', touchAction: 'none' }}>
        <Canvas frameloop={inWorld ? 'always' : 'never'} dpr={[1, 2]} camera={{ position: [0, 7, 12], fov: 34, near: 0.1, far: 80 }} gl={{ antialias: false, powerPreference: 'high-performance' }}>
          <Suspense fallback={null}>
            <WorldScene view={screen === 'booster' ? 'booster' : 'title'} fx={stage} />
          </Suspense>
        </Canvas>
      </div>
      <div className={`wme${inWorld ? '' : ' ground'}`}>{body}</div>
      <CardLayer />
    </>
  );
}
