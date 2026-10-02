"use client";

import { useState } from "react";
import { CopyButton } from "./copy-button";
import { Tabs, useTabPrefix } from "./tabs";

const PMS = [
  { id: "npm", cmd: (p: string) => `npm install ${p}` },
  { id: "pnpm", cmd: (p: string) => `pnpm add ${p}` },
  { id: "yarn", cmd: (p: string) => `yarn add ${p}` },
  { id: "bun", cmd: (p: string) => `bun add ${p}` },
];

/** An install command with package-manager tabs and a copy button. `packages` may list several, space separated. */
export function InstallTabs({ packages, label = "Install" }: { packages: string; label?: string }) {
  const [pm, setPm] = useState("npm");
  const prefix = useTabPrefix("pm");
  const cmd = PMS.find((p) => p.id === pm)!.cmd(packages);
  return (
    <div className="install">
      <div className="install__bar">
        <Tabs tabs={PMS.map((p) => ({ id: p.id, label: p.id, mono: true }))} value={pm} onChange={setPm} label={`${label}: package manager`} prefix={prefix} />
      </div>
      <div className="install__cmd" role="tabpanel" id={`${prefix}-panel-${pm}`} aria-labelledby={`${prefix}-tab-${pm}`}>
        <code data-testid="install-cmd">
          <span className="prompt" aria-hidden="true">$</span>
          {cmd}
        </code>
        <CopyButton text={cmd} target={`install-${pm}`} />
      </div>
    </div>
  );
}
