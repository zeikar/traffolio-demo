import { appendFile } from "node:fs/promises";

type Env = Record<string, string | undefined>;

/** Appends `name=value` to `$GITHUB_OUTPUT`; no-op outside Actions. `value` must be single-line. */
export async function setOutput(name: string, value: string, env: Env): Promise<void> {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  await appendFile(file, `${name}=${value}\n`, "utf8");
}

/** Appends markdown to `$GITHUB_STEP_SUMMARY`; no-op outside Actions. */
export async function writeSummary(markdown: string, env: Env): Promise<void> {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  await appendFile(file, markdown, "utf8");
}
