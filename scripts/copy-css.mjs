import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
cpSync("src/styles/style.css", "dist/style.css");
cpSync("src/styles/tailwind.css", "dist/tailwind.css");
