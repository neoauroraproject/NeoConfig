'use client';

import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  closeLabel: string;
};

/** Bottom sheet: opaque surface, scrim, Esc to close, focus moves in and back out. */
export function Sheet({ open, onClose, title, children, closeLabel }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  // Dragging starts only from the grab bar / title row; anywhere else scrolls the sheet.
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const id = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>('[data-autofocus], button, input, a')?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, a[href], textarea, [tabindex="0"]',
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center wide:items-center wide:p-6" role="presentation">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative max-h-[88dvh] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-t-5xl bg-[var(--sheet)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-ink shadow-raise wide:max-w-[480px] wide:rounded-5xl wide:pb-6"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            drag="y"
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            <div
              className="-mx-5 -mt-3 mb-1 cursor-grab touch-none px-5 pb-2 pt-3"
              onPointerDown={(e) => drag.start(e)}
              aria-hidden
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-sunk" />
            </div>
            <div className="mb-4 flex touch-none items-center justify-between gap-3" onPointerDown={(e) => drag.start(e)}>
              <h2 className="text-lg font-semibold">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
