import { parseMarkdown } from "./story";

/** A story as React elements: headings, bullets, bold and code, never raw HTML. */
export function Prose({ text }: { text: string }) {
  return <div className="prose">{parseMarkdown(text).map((block, index) => {
    const inline = (parts: ReturnType<typeof parseMarkdown> extends Array<infer B> ? (B extends { inline: infer I } ? I : never) : never) => parts.map((part, i) => part.code ? <code key={i}>{part.text}</code> : part.bold ? <b key={i}>{part.text}</b> : <span key={i}>{part.text}</span>);
    if (block.type === "ul") return <ul key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
    if (block.type === "h1") return <h3 key={index} className="prose-title">{inline(block.inline)}</h3>;
    if (block.type === "h2") return <h4 key={index}>{inline(block.inline)}</h4>;
    if (block.type === "h3") return <h5 key={index}>{inline(block.inline)}</h5>;
    return <p key={index}>{inline(block.inline)}</p>;
  })}</div>;
}
