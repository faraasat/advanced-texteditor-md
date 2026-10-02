"use client";

import type { ComponentType } from "react";
import { CollapsibleDemo, DraftsDemo, EmbedsDemo, FindDemo, HandlesDemo, HighlightDemo, ImagesDemo, MathDemo, MentionsDemo, PluginsDemo, SyntaxDemo, ThemesDemo, UploadsDemo } from "./demos";

const DEMOS: Record<string, ComponentType> = {
  mentions: MentionsDemo,
  uploads: UploadsDemo,
  math: MathDemo,
  highlight: HighlightDemo,
  embeds: EmbedsDemo,
  plugins: PluginsDemo,
  syntax: SyntaxDemo,
  drafts: DraftsDemo,
  find: FindDemo,
  images: ImagesDemo,
  handles: HandlesDemo,
  collapsible: CollapsibleDemo,
  themes: ThemesDemo,
};

/** Picks the live demo for a feature id. Kept in one client module so the server page passes only a string. */
export function FeatureDemo({ id }: { id: string }) {
  const Demo = DEMOS[id];
  return Demo ? <Demo /> : null;
}
