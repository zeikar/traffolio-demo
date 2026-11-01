import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const repositoriesSchema = z
  .object({
    include: z.array(z.string()).default(["*"]),
    exclude: z.array(z.string()).default([]),
    include_private: z.boolean().default(false),
    include_forks: z.boolean().default(false),
    include_archived: z.boolean().default(false),
    include_self: z.boolean().default(false),
  })
  .strict();

const configSchema = z
  .object({
    // prefault (not default): Zod v4 default() skips parsing, so inner defaults would not apply.
    repositories: repositoriesSchema.prefault({}),
    public_mode: z.boolean().default(false),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;

export function parseConfig(yamlText: string): Config {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (err) {
    throw new ConfigError(`Invalid YAML: ${(err as Error).message}`);
  }
  // An empty file parses to null; treat it as "all defaults".
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      // Unrecognized-key issues carry the parent path; append the offending keys.
      const path =
        issue.code === "unrecognized_keys"
          ? [...issue.path, ...issue.keys]
          : issue.path;
      return `${path.map(String).join(".") || "(root)"}: ${issue.message}`;
    });
    throw new ConfigError(`Invalid config:\n${lines.join("\n")}`);
  }
  return result.data;
}

export async function loadConfig(path: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`Config file not found: ${path}`);
    }
    throw err;
  }
  return parseConfig(text);
}
