import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  links: { href: string; label: string }[];
  current: string;
}

export default function MobileNav({ links, current }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        className="btn btn-square btn-ghost"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {/* portalled: the header's backdrop blur would otherwise become the containing
          block for this fixed panel and squash it into the header's height */}
      {open && createPortal(
        <div id={id} className="fixed inset-x-0 top-[57px] bottom-0 z-40 bg-base-100 px-4 py-6">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                aria-current={current === l.href ? 'page' : undefined}
                className={
                  'rounded-box px-4 py-3 text-lg font-medium hover:bg-base-200 ' +
                  (current === l.href ? 'text-primary' : 'text-base-content')
                }
              >
                {l.label}
              </a>
            ))}
            <a href="/app" className="btn btn-lg btn-primary mt-4">
              Open the designer
            </a>
          </nav>
        </div>,
        document.body,
      )}
    </div>
  );
}
