import { parseMarkdown, type Inline } from "./story";

/** A story or an answer as React elements: headings, bullets, bold, code and session links, never raw HTML. */
export function Prose({ text, onRef }: { text: string; onRef?: (ref: string) => void }) {
  const inline = (parts: Inline[]) => parts.map((part, i) => part.ref
    ? (onRef ? <button key={i} className="cite" onClick={() => onRef(part.ref!)} title={part.ref}>{part.ref}</button> : <span key={i} className="cite">{part.ref}</span>)
    : part.code ? <code key={i}>{part.text}</code> : part.bold ? <b key={i}>{part.text}</b> : <span key={i}>{part.text}</span>);
  return <div className="prose">{parseMarkdown(text).map((block, index) => {
    if (block.type === "ul") return <ul key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
    if (block.type === "h1") return <h3 key={index} className="prose-title">{inline(block.inline)}</h3>;
    if (block.type === "h2") return <h4 key={index}>{inline(block.inline)}</h4>;
    if (block.type === "h3") return <h5 key={index}>{inline(block.inline)}</h5>;
    return <p key={index}>{inline(block.inline)}</p>;
  })}</div>;
}
