import { pressKey, tick } from "../../plugins/helpers";

/** Enter like a browser: keydown, then (when not consumed) the beforeinput the surface handles. */
export async function enter(root: HTMLElement): Promise<void> {
  const kd = pressKey(root, "Enter");
  if (!kd.defaultPrevented) root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertParagraph", cancelable: true, bubbles: true }));
  await tick();
}

/** The canonical Markdown of a columns block (stringify separates the columns with a blank line). */
export const COLS = (...c: string[]) => "::: columns\n" + c.map((x) => "::: col\n" + (x ? x + "\n" : "") + ":::").join("\n\n") + "\n:::";
