// Shows Markdown as a page: the tree from markdown.ts, as elements. Text
// goes in as text, so nothing in the file runs.

import { useMemo } from "preact/hooks";

import { t } from "../i18n.ts";
import { languageOfFence } from "./highlight.ts";
import { Highlighted } from "./highlight-view.tsx";
import { type Block, type Inline, parseMarkdown } from "./markdown.ts";

export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div class="markdown">{blocks.map((block, index) => <BlockView key={index} block={block} />)}</div>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      const Heading = `h${block.level}` as const;
      return (
        <Heading>
          <Inlines nodes={block.children} />
        </Heading>
      );
    }
    case "paragraph":
      return (
        <p>
          <Inlines nodes={block.children} />
        </p>
      );
    case "code":
      return (
        <pre>
          <code>
            <Highlighted text={block.text} language={languageOfFence(block.language)} />
          </code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          {block.children.map((child, index) => (
            <BlockView key={index} block={child} />
          ))}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} class={item.checked === null ? undefined : "task"}>
          {item.checked !== null && (
            <input
              type="checkbox"
              checked={item.checked}
              disabled
              aria-label={item.checked ? t("markdown.done") : t("markdown.notDone")}
            />
          )}
          {item.children.map((child, index) => (
            <BlockView key={index} block={child} />
          ))}
        </li>
      ));
      const tight = block.tight ? "tight" : undefined;
      return block.ordered ? (
        <ol class={tight} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul class={tight}>{items}</ul>
      );
    }
    case "rule":
      return <hr />;
    case "table":
      return (
        <div class="markdown-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} style={align(block.align[index])}>
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} style={align(block.align[column])}>
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function align(value: string | null | undefined) {
  return value ? { textAlign: value } : undefined;
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineView key={index} node={node} />
      ))}
    </>
  );
}

function InlineView({ node }: { node: Inline }) {
  switch (node.type) {
    case "text":
      return <>{node.text}</>;
    case "strong":
      return (
        <strong>
          <Inlines nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );
    case "del":
      return (
        <del>
          <Inlines nodes={node.children} />
        </del>
      );
    case "code":
      return <code>{node.text}</code>;
    case "break":
      return <br />;
    case "link":
      return node.href ? (
        <a href={node.href} target="_blank" rel="noopener noreferrer">
          <Inlines nodes={node.children} />
        </a>
      ) : (
        <Inlines nodes={node.children} />
      );
    case "image": {
      // A link rather than the picture, which would load from another
      // server each time the file is opened.
      const name = node.alt ? t("markdown.picture", { name: node.alt }) : t("markdown.pictureUnnamed");
      return node.href ? (
        <a class="markdown-picture" href={node.href} target="_blank" rel="noopener noreferrer">
          {name}
        </a>
      ) : (
        <span class="markdown-picture">{name}</span>
      );
    }
  }
}
