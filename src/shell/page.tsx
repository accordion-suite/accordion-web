import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** A page's heading. It takes focus when the page opens, so screen readers
 * announce the new page, as they do after a full page load. */
export function PageTitle({ children }: { children: ComponentChildren }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <h1 ref={heading} tabIndex={-1}>
      {children}
    </h1>
  );
}
