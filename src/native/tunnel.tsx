import { Fragment, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

// Lets an HTML screen put 3D content into the world canvas (another React renderer): <World.In>
// stores its children, <World.Out> inside the canvas renders them. Props and refs pass through;
// React context does not (the canvas has its own).

function createTunnel() {
  const slots = new Map<number, ReactNode>();
  const subs = new Set<() => void>();
  let snapshot: [number, ReactNode][] = [];
  let next = 0;
  const emit = () => {
    snapshot = [...slots.entries()].sort((a, b) => a[0] - b[0]);
    subs.forEach((f) => f());
  };
  function In({ children }: { children: ReactNode }) {
    const id = useRef(0);
    if (!id.current) id.current = ++next;
    useLayoutEffect(() => {
      slots.set(id.current, children);
      emit();
    });
    useLayoutEffect(
      () => () => {
        slots.delete(id.current);
        emit();
      },
      [],
    );
    return null;
  }
  function Out() {
    const nodes = useSyncExternalStore(
      (f) => (subs.add(f), () => void subs.delete(f)),
      () => snapshot,
    );
    return (
      <>
        {nodes.map(([id, n]) => (
          <Fragment key={id}>{n}</Fragment>
        ))}
      </>
    );
  }
  return { In, Out };
}

export const World = createTunnel();
