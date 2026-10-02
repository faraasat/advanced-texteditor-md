/**
 * A word (or character) goal. Shows a `<progress>` named "Word goal" with the value text
 * "120 of 500 words" in the editor's status bar (`.atm-statusbar`), or as a small badge in the
 * editor's corner when there is none, announces once (politely) when the goal is reached, calls
 * `onReached`, and emits `plugin:writing:goal` on every count change.
 *
 * Counting uses `readingStats(editor.getAst())`: the document's text, not its Markdown syntax.
 * This plugin is the goal tracker only; a reading-time or word-count item drawn by other chrome is
 * separate, and `readingStats` is the pure helper both can call (the two never draw the same thing).
 */
import type { EditorInstance, Plugin } from "../../types";
import { h } from "../_shared";
import { readingStats, type ReadingStatsOptions } from "./stats";
import { byElement, liveRegion } from "./util";

export type GoalUnit = "words" | "characters";
export type GoalInfo = { count: number; goal: number; unit: GoalUnit; reached: boolean; fraction: number };

export type WordGoalLabels = {
  /** Accessible name of the progress bar. */
  name: string;
  units: Record<GoalUnit, string>;
  /** Visible text and value text. */
  value: (count: number, goal: number, unit: string) => string;
  reached: (goal: number, unit: string) => string;
};

export type WordGoalOptions = {
  goal: number;
  unit?: GoalUnit;
  onReached?: (info: GoalInfo) => void;
  /** Put the item in the status bar when the layout has one. Default true. */
  showInStatusBar?: boolean;
  /** Without a status bar (or with `showInStatusBar: false`), show a floating badge. Default true. */
  badge?: boolean;
  /** Passed to `readingStats` (e.g. `includeCode: false`). */
  stats?: ReadingStatsOptions;
  /** Wait after an edit before counting, ms. Default 150. */
  debounceMs?: number;
  labels?: Partial<WordGoalLabels>;
};

export const GOAL_EVENT = "plugin:writing:goal";

const DEFAULTS: WordGoalLabels = {
  name: "Word goal",
  units: { words: "words", characters: "characters" },
  value: (c, g, u) => `${c} of ${g} ${u}`,
  reached: (g, u) => `Goal reached: ${g} ${u}`,
};

const validGoal = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null);

export function createWordGoalPlugin(options: WordGoalOptions): Plugin {
  const labels: WordGoalLabels = { ...DEFAULTS, ...options.labels, units: { ...DEFAULTS.units, ...options.labels?.units } };
  const unit: GoalUnit = options.unit === "characters" ? "characters" : "words";
  const debounce = Math.max(0, options.debounceMs ?? 150);
  const updates = new WeakMap<HTMLElement, (now?: boolean) => void>();
  const goals = new WeakMap<EditorInstance, (n: number) => boolean>();

  return {
    name: "writing-goal",
    commands: {
      setWordGoal: (ed, args) => !!goals.get(ed)?.(args as number),
    },
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      let goal = validGoal(options.goal) ?? 500;
      let count = -1;
      let armed = true;
      let first = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const live = liveRegion(ed, "goal");
      const bar = options.showInStatusBar === false ? null : el.querySelector<HTMLElement>(".atm-statusbar");
      if (!bar && options.badge === false) {
        live.remove();
        return;
      }
      const progress = h(doc, "progress", { class: "atm-writing-goal-bar", max: goal, value: 0, "aria-label": labels.name });
      const text = h(doc, "span", { class: "atm-writing-goal-text", "aria-hidden": "true" });
      // Inside the status bar (a live region of its own) the item is not announced on every change.
      const item = h(doc, "span", { class: bar ? "atm-writing-goal" : "atm-writing-goal atm-writing-goal-badge", "aria-live": "off", "data-reached": "false" }, progress, text);
      (bar ?? el).appendChild(item);

      const update = () => {
        timer = null;
        const st = readingStats(ed.getAst(), options.stats);
        const n = unit === "words" ? st.words : st.characters;
        if (n === count && !first) return;
        count = n;
        const reached = n >= goal;
        const u = labels.units[unit];
        const msg = labels.value(n, goal, u);
        progress.max = goal;
        progress.value = Math.min(n, goal);
        progress.setAttribute("aria-valuetext", msg);
        text.textContent = msg;
        item.setAttribute("data-reached", String(reached));
        const info: GoalInfo = { count: n, goal, unit, reached, fraction: Math.min(1, n / goal) };
        // A document that starts over the goal has not "reached" it: only a crossing announces.
        if (first) armed = !reached;
        else if (reached && armed) {
          armed = false;
          live.say(labels.reached(goal, u));
          try {
            options.onReached?.(info);
          } catch (e) {
            if (typeof console !== "undefined") console.error(e);
          }
        } else if (!armed && n < goal * 0.9) armed = true; // re-arm only well below, so a word at the edge does not repeat it
        first = false;
        ed.emit(GOAL_EVENT, info);
      };
      const schedule = (now?: boolean) => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (now || debounce === 0) update();
        else timer = setTimeout(update, debounce);
      };
      updates.set(el, schedule);
      goals.set(ed, (n) => {
        const g = validGoal(n);
        if (g === null) return false;
        goal = g;
        first = true;
        schedule(true);
        return true;
      });
      const offs = [ed.on("change", () => schedule()), ed.on("pane", () => schedule())];
      schedule(true);
      return () => {
        if (timer) clearTimeout(timer);
        offs.forEach((o) => o());
        item.remove();
        live.remove();
        updates.delete(el);
        goals.delete(ed);
      };
    },
    // setValue redraws the surface without a change event: count again.
    postRender: (root, ctx) => ctx.mode === "editor" && byElement(root, updates)?.(),
  };
}
