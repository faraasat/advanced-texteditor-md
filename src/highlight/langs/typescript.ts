import type { LanguageDef } from "../../types";
import { jsRules } from "./_shared";

const typescript: LanguageDef = { name: "typescript", aliases: ["ts", "tsx", "mts", "cts"], rules: jsRules(true) };
// Named as well as default, so `require()` returns { default, typescript } like any other module (a lone
// default export is flattened by CommonJS interop, which no longer matches the d.cts).
export { typescript };
export default typescript;