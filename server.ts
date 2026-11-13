// bb-plugin-prompt-jump: the plugin is frontend-only (see app.tsx). bb
// requires a server entry, so this one does nothing.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(_bb: BbPluginApi) {}
