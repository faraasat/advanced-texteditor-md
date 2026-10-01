import type { BlockSyntax, InlineSyntax, Plugin } from "../types";

/** Identity helpers: they exist so a host gets full type checking and autocomplete. */
export function definePlugin<T extends Plugin>(plugin: T): T {
  return plugin;
}
export function defineInlineSyntax<T extends InlineSyntax>(syntax: T): T {
  return syntax;
}
export function defineBlockSyntax<T extends BlockSyntax>(syntax: T): T {
  return syntax;
}
