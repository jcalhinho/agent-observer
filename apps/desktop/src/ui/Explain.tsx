import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { t } from "./i18n";

/**
 * A small "i" button that reveals an explanation. Opens on hover, focus or click; Escape and a
 * click elsewhere close it. The text is linked to the button for screen readers.
 */
export function InfoTip({ children, label = t("Explication", "Explanation"), align = "start" }: { children: ReactNode; label?: string; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setPinned(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setPinned(false); } };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, [open]);
  return <span className="infotip" ref={root} onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned) setOpen(false); }}>
    <button type="button" className="infotip-button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onBlur={() => { if (!pinned) setOpen(false); }} onClick={() => { setPinned((value) => !value); setOpen(true); }}>
      <Info size={13} />
    </button>
    {open && <span role="tooltip" id={id} className={`infotip-bubble ${align}`}>{children}</span>}
  </span>;
}

/**
 * Section title on one line. The short description sits beside it, cut to one line; the full text
 * and the details are in the "i" next to the title so nothing is lost and nothing takes room.
 */
export function SectionHeader({ title, description, details, actions, level = 2 }: { title: ReactNode; description: ReactNode; details?: ReactNode; actions?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return <header className={`section-header level-${level}`}>
    <Heading>{title}<InfoTip label={t(`En savoir plus : ${typeof title === "string" ? title : "section"}`, `More about: ${typeof title === "string" ? title : "this section"}`)}><span className="tip-stack"><span>{description}</span>{details && <span>{details}</span>}</span></InfoTip></Heading>
    <p className="section-desc">{description}</p>
    {actions && <div className="section-header-actions">{actions}</div>}
  </header>;
}

/** Empty state that says what is missing and what to do about it. */
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><b>{title}</b><p>{children}</p>{action}</div>;
}
