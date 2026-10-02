import type { LanguageDef } from "../../types";
import { jsRules } from "./_shared";

const javascript: LanguageDef = { name: "javascript", aliases: ["js", "jsx", "mjs", "cjs"], rules: jsRules(false) };
// Named as well as default, so `require()` returns { default, javascript } like any other module (a lone
// default export is flattened by CommonJS interop, which no longer matches the d.cts).
export { javascript };
export default javascript;