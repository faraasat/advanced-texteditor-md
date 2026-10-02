import type { ReactNode, RefObject } from "react";

/**
 * The box a live editor mounts into. It reserves the editor's height up front and shows a skeleton until the editor
 * is ready, so the page does not jump when the (lazy) library arrives. The host itself is empty on purpose: the
 * library owns its children.
 */
export function DemoHost({ wrapRef, hostRef, ready, minHeight, label, children }: { wrapRef: RefObject<HTMLDivElement | null>; hostRef: RefObject<HTMLDivElement | null>; ready: boolean; minHeight: number; label: string; children?: ReactNode }) {
  return (
    <div className="demo-host" ref={wrapRef} style={{ minHeight }} role="group" aria-label={label} aria-busy={!ready}>
      <div className="demo-host__skel" hidden={ready} aria-hidden="true">
        <i className="shim" style={{ width: "42%" }} />
        <i className="shim" style={{ width: "88%" }} />
        <i className="shim" style={{ width: "70%" }} />
      </div>
      <div data-editor-host ref={hostRef} />
      {children}
    </div>
  );
}
