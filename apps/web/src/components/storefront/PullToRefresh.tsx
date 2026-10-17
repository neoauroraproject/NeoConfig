'use client';

import { RefreshCw } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

const TRIGGER = 64;

/**
 * Native-style pull to refresh. The page itself has overscroll-behavior: none
 * (no browser reload, no rubber band), so a pull at the very top drives this
 * indicator instead. Listeners are passive: scrolling is never blocked.
 */
export function PullToRefresh({
  onRefresh,
  refreshing,
  disabled,
  children,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  const current = useRef(0);
  const cb = useRef({ onRefresh, disabled });
  cb.current = { onRefresh, disabled };

  useEffect(() => {
    const set = (v: number) => {
      current.current = v;
      setPull(v);
    };
    const down = (e: TouchEvent) => {
      start.current = !cb.current.disabled && window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      if (window.scrollY > 0) {
        start.current = null;
        set(0);
        return;
      }
      const dy = e.touches[0].clientY - start.current;
      // Resistance grows with distance, like a rubber band.
      set(dy <= 0 ? 0 : Math.min(112, dy * 0.55 - (dy * dy) / 4000));
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      if (current.current >= TRIGGER) {
        navigator.vibrate?.(8);
        cb.current.onRefresh();
      }
      set(0);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, []);

  const shown = refreshing ? 1 : Math.min(1, pull / TRIGGER);
  const y = refreshing ? 18 : pull - 44;
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top,0px)] z-[45] flex justify-center"
        style={{
          transform: `translateY(${y}px)`,
          opacity: shown,
          transition: pull ? 'none' : 'transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 200ms',
        }}
      >
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--sheet)] text-ink shadow-raise">
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)`, opacity: pull >= TRIGGER ? 1 : 0.6 }}
          />
        </span>
      </div>
      {children}
    </>
  );
}
