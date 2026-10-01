import type { LanguageDef } from "../../types";
import { jsRules } from "./_shared";

const typescript: LanguageDef = { name: "typescript", aliases: ["ts", "tsx", "mts", "cts"], rules: jsRules(true) };
export default typescript;
