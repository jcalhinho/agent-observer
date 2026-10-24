import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { ContextMeter } from "./ContextMeter";
import type { ContextUsage } from "./contextUsage";
import { setLang } from "./i18n";

const base: ContextUsage = { used: 570_618, window: 1_000_000, percent: 57.1, cachedShare: 0.99, state: "ok", series: [100_000, 300_000, 570_618], compactions: 0, model: "claude-sonnet-5-5", windowSource: "reported" };

beforeAll(() => setLang("en"));

describe("the context meter", () => {
  it("shows the share, the tokens and the window", () => {
    const html = renderToStaticMarkup(<ContextMeter usage={base} />);
    expect(html).toContain("57 % · 570.6K / 1M");
    expect(html).toContain("width:57.1%");
    expect(html).toContain("state-ok");
    expect(html).toContain("99% come from the cache");
  });

  it("turns amber then red, and says when the context was compacted", () => {
    expect(renderToStaticMarkup(<ContextMeter usage={{ ...base, state: "warn", percent: 85 }} />)).toContain("state-warn");
    const full = renderToStaticMarkup(<ContextMeter usage={{ ...base, state: "full", percent: 97, compactions: 2 }} />);
    expect(full).toContain("state-full");
    expect(full).toContain("compacted ×2");
  });

  it("has no bar and no percentage when the window is unknown", () => {
    const html = renderToStaticMarkup(<ContextMeter usage={{ ...base, window: null, percent: null, state: "unknown", windowSource: null }} />);
    expect(html).not.toContain("role=\"meter\"");
    expect(html).toContain("5");
    expect(html).toContain("no percentage");
  });

  it("draws the trend only on request", () => {
    expect(renderToStaticMarkup(<ContextMeter usage={base} />)).not.toContain("<svg");
    expect(renderToStaticMarkup(<ContextMeter usage={base} trend />)).toContain("<polyline");
  });
});
