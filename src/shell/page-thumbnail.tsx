// A page thumbnail drawn as a small page: an HTML page's first lines, such
// as a Docs document's, with its headings, lists, checklists, and styles.
// It's drawn with the app's colors, so it follows light and dark mode.

import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { type PageLine, pageLines, type Run } from "./page-lines.ts";

/** The page thumbnail at `src`. Like a lazy image, it waits until it's nearly
 * on screen, so a folder of a thousand pages doesn't fetch them all at
 * once. `onError` runs if it can't be fetched or drawn, so the card can show
 * an icon instead. */
export function PageThumbnail({ src, onError }: { src: string; onError: () => void }) {
  const page = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<PageLine[]>([]);
  useEffect(() => {
    const element = page.current;
    if (!element) return;
    let current = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        fetch(src)
          .then((response) => (response.ok ? response.json() : Promise.reject()))
          .then((json: unknown) => {
            const found = pageLines(json);
            if (!found) return Promise.reject();
            if (current) setLines(found);
          })
          .catch(() => current && onError());
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [src]);
  return (
    <div ref={page} class="page-thumbnail">
      {lines.map((line, index) => (
        <Line key={index} line={line} />
      ))}
    </div>
  );
}

function Line({ line }: { line: PageLine }) {
  const classes = ["page-line", `page-${line.kind}`];
  if (line.kind === "heading") classes.push(`page-h${Math.min(line.level, 4)}`);
  if (line.kind === "check" && line.checked) classes.push("is-checked");
  if (line.depth > 0) classes.push(`page-depth-${Math.min(line.depth, 4)}`);
  if (line.quote) classes.push("page-quote");
  return (
    <div class={classes.join(" ")}>
      {line.kind === "item" && <span class="page-mark">{line.mark}</span>}
      {line.kind === "check" && <span class="page-box" />}
      {line.kind === "row" ? (
        line.cells.map((cell, index) => (
          <span key={index} class="page-cell">
            <Runs runs={cell} />
          </span>
        ))
      ) : (
        <span class="page-runs">
          <Runs runs={line.runs} />
        </span>
      )}
    </div>
  );
}

/** Styled text. Each style is its own element, so underline and
 * strikethrough can both show on the same words. */
function Runs({ runs }: { runs: Run[] }) {
  // An empty line, such as from two line breaks, keeps its height.
  if (!runs.some((run) => run.text.trim())) return <>{"\u00a0"}</>;
  return (
    <>
      {runs.map((run, index) => (
        <Fragment key={index}>
          {run.styles.reduce<ComponentChildren>(
            (child, style) => (
              <span class={`page-run-${style}`}>{child}</span>
            ),
            run.text,
          )}
        </Fragment>
      ))}
    </>
  );
}
