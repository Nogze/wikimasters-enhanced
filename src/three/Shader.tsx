import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

type Props = {
  vertexShader: string;
  fragmentShader: string;
  /** Kept by reference: write `uniforms.x.value` in useFrame and the GPU sees it. */
  uniforms?: Record<string, THREE.IUniform>;
  transparent?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  blending?: THREE.Blending;
};

const NONE: Record<string, THREE.IUniform> = {};

/**
 * A ShaderMaterial attached to the parent mesh that keeps *our* uniforms object. With
 * `<shaderMaterial uniforms={u}>`, the instance R3F ends up attaching can hold a different
 * uniforms object than the one a component's useFrame writes to, so the shader never sees updates.
 */
export function Shader({ vertexShader, fragmentShader, uniforms = NONE, transparent = false, depthWrite = true, depthTest = true, blending = THREE.NormalBlending }: Props) {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent, depthWrite, depthTest, blending }),
    [vertexShader, fragmentShader, uniforms, transparent, depthWrite, depthTest, blending],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return <primitive object={mat} attach="material" />;
}
