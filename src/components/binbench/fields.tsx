import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { Units } from './units';

interface LengthFieldProps {
  label: ReactNode;
  /** value in mm (or a plain number when `plain`) */
  value: number;
  units: Units;
  /** receives mm (or the plain number), or null when the box was left empty/invalid */
  onCommit: (v: number | null) => void;
  /** commit on every keystroke instead of on blur/Enter */
  live?: boolean;
  /** a unitless count rather than a length */
  plain?: boolean;
  step?: number;
  min?: number;
  className?: string;
  inputClassName?: string;
  title?: string;
  placeholder?: string;
}

/** A number box that shows a mm value in the current display unit. Keeps its own
 *  text while focused so typing "1." or clearing the box isn't fought by re-renders. */
export function LengthField({
  label, value, units, onCommit, live, plain, step, min, className, inputClassName, title, placeholder,
}: LengthFieldProps) {
  const id = useId();
  const shown = plain ? value : units.toDisplay(value);
  const [text, setText] = useState(String(shown));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(Number.isFinite(shown) ? String(shown) : '');
  }, [shown]);

  const parse = (t: string) => {
    const n = parseFloat(t);
    if (!isFinite(n)) return null;
    return plain ? n : units.toMM(n);
  };

  return (
    <div className={'min-w-0 flex-1 ' + (className ?? '')}>
      {label !== '' && (
        <label htmlFor={id} className="bb-label">
          {label}
        </label>
      )}
      <input
        id={id}
        type="number"
        className={'bb-input ' + (inputClassName ?? '')}
        value={text}
        step={step}
        min={min}
        title={title}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          if (live) onCommit(parse(e.target.value));
        }}
        onBlur={(e) => {
          focused.current = false;
          if (!live) onCommit(parse(e.target.value));
          else setText(String(shown));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !live) (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export function UnitSuffix({ units }: { units: Units }) {
  return <span className="normal-case">({units.suffix})</span>;
}

export function Panel({
  title, badge, children, defaultOpen, tour, headerExtra,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tour?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <details className="bb-panel group mb-2.5 overflow-hidden" open={defaultOpen} data-tour={tour}>
      <summary className="bb-h flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 select-none hover:text-base-content [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] text-primary transition-transform group-open:rotate-90" aria-hidden>
          ▶
        </span>
        {title}
        {headerExtra}
        {badge != null && <span className="bb-mono-dim ml-auto text-[10.5px]">{badge}</span>}
      </summary>
      <div className="px-3.5 pt-0.5 pb-3.5">{children}</div>
    </details>
  );
}

export function Section({
  title, badge, children, tour, className,
}: {
  title: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  tour?: string;
  className?: string;
}) {
  return (
    <section className={'bb-panel mb-3.5 px-4 py-3.5 ' + (className ?? '')} data-tour={tour}>
      <h2 className="bb-h mb-3 flex flex-wrap items-baseline gap-2">
        {title}
        {badge != null && <span className="bb-mono-dim">{badge}</span>}
      </h2>
      {children}
    </section>
  );
}
