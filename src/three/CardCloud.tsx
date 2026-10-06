import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { reducedMotion } from '../lib/motion';
import { drawCardBack, toTexture } from './cardTexture';

/** Card backs drifting in the dark around the stage, one instanced mesh. */
export function CardCloud({ count = 56 }: { count?: number }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let off = false;
    drawCardBack().then((c) => !off && setTex(toTexture(c)));
    return () => {
      off = true;
    };
  }, []);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1.4), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, () => {
        // Keep a clear corridor in the middle, where the circle and the screens are.
        let x = (Math.random() - 0.5) * 30;
        if (Math.abs(x) < 2.5) x += Math.sign(x || 1) * 2.5;
        return { x, y: -0.5 + Math.random() * 12, z: -3 - Math.random() * 16, ry: Math.random() * 6.28, rx: (Math.random() - 0.5) * 0.7, sp: 0.08 + Math.random() * 0.25, ph: Math.random() * 6.28, s: 0.55 + Math.random() * 0.6 };
      }),
    [count],
  );
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = reducedMotion() ? 0 : clock.elapsedTime;
    seeds.forEach((s, i) => {
      dummy.position.set(s.x + Math.sin(t * 0.07 + s.ph) * 0.4, s.y + Math.sin(t * s.sp + s.ph) * 0.3, s.z);
      dummy.rotation.set(s.rx, s.ry + t * s.sp * 0.6, Math.sin(t * 0.15 + s.ph) * 0.12);
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  if (!tex) return null;
  return (
    <instancedMesh ref={mesh} args={[geo, undefined, count]} frustumCulled={false}>
      <meshBasicMaterial map={tex} side={THREE.DoubleSide} fog />
    </instancedMesh>
  );
}
