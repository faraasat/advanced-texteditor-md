import type { LanguageDef } from "../../types";
import { alt } from "./_shared";

const KW =
  "select from where and or not in is as on join inner outer left right full cross natural group by order having limit offset union all distinct insert into values update set delete create alter drop table index view database schema primary key foreign references unique default check constraint add column if exists case when then else end between like ilike asc desc with recursive returning begin commit rollback transaction truncate grant revoke using over partition window exists any some cascade";
const TYPES =
  "int integer bigint smallint serial bigserial boolean bool text varchar char character numeric decimal real double precision float date time timestamp timestamptz interval uuid json jsonb bytea blob";

const sql: LanguageDef = {
  name: "sql",
  aliases: ["pgsql", "mysql", "sqlite", "plpgsql", "postgresql"],
  rules: [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/ },
    { token: "string", regex: /'(?:[^']|'')*'?/ },
    { token: "variable", regex: /"[^"\n]*"?|`[^`\n]*`?|\$\d+|[:@]\w+/ },
    { token: "number", regex: /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\b/ },
    { token: "literal", regex: new RegExp(`${alt("null true false")}\\b`, "i") },
    { token: "keyword", regex: new RegExp(`${alt(KW)}\\b`, "i") },
    { token: "type", regex: new RegExp(`${alt(TYPES)}\\b`, "i") },
    { token: "function", regex: /[A-Za-z_]\w*(?=\s*\()/ },
    { token: "", regex: /[A-Za-z_]\w*/ },
    { token: "operator", regex: /[+\-*/%=<>!|&^~:]+/ },
    { token: "punctuation", regex: /[(),;.[\]]/ },
  ],
};
export default sql;
