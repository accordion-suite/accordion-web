import { useEffect, useRef } from "preact/hooks";

import { t } from "../i18n.ts";

/** A page's heading. It takes focus when the page opens, so screen readers
 * announce the new page, as they do after a full page load. It also names
 * the browser tab after the page, or after `tab` when that reads better,
 * such as with the section it's in. */
export function PageTitle({ children, tab, bare }: { children: string; tab?: string; bare?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const name = tab ?? children;
  useTabTitle(bare ? name : t("shell.tabTitle", { page: name }));
  return (
    <h1 ref={heading} tabIndex={-1}>
      {children}
    </h1>
  );
}

/** Tab titles from what's showing, newest last, such as a folder and then
 * a file open in the viewer over it. Closing the viewer brings back the
 * folder's, even if the folder was renamed while it was open. */
const titles: { title: string }[] = [];

function showTitle() {
  document.title = titles.at(-1)?.title ?? t("shell.tabTitleNone");
}

/** Names the browser tab `title` while the component shows. */
export function useTabTitle(title: string) {
  const entry = useRef<{ title: string } | null>(null);
  useEffect(() => {
    const mine = { title };
    entry.current = mine;
    titles.push(mine);
    showTitle();
    return () => {
      titles.splice(titles.indexOf(mine), 1);
      showTitle();
    };
  }, []);
  useEffect(() => {
    if (entry.current) entry.current.title = title;
    showTitle();
  }, [title]);
}
