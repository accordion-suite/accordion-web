// Code as colored text, for the viewer and Markdown's code blocks.

import { useMemo } from "preact/hooks";

import { HIGHLIGHT_LIMIT, highlight } from "./highlight.ts";

/** `text` colored as `language`, or plain when there's no language or the
 * text is too long to color quickly. */
export function Highlighted({ text, language }: { text: string; language: string | null }) {
  const tokens = useMemo(
    () => (language && text.length <= HIGHLIGHT_LIMIT ? highlight(text, language) : null),
    [text, language],
  );
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, index) =>
        token.kind ? (
          <span key={index} class={`tok-${token.kind}`}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </>
  );
}
