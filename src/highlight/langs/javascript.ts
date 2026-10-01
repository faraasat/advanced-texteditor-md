import type { LanguageDef } from "../../types";
import { jsRules } from "./_shared";

const javascript: LanguageDef = { name: "javascript", aliases: ["js", "jsx", "mjs", "cjs"], rules: jsRules(false) };
export default javascript;
