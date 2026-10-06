// The player's reduced-motion preference (shortens the opening, stills the background).
const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => mq?.matches ?? false;
