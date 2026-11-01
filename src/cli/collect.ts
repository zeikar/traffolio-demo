import { runCollect } from "../run-collect.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

try {
  const result = await runCollect({
    env: process.env,
    fetch,
    sleep,
    rootDir: process.cwd(),
    now: Date.now,
    log: (line) => console.log(line),
  });
  console.log(`collect finished: outcome=${result.outcome} commit=${result.commit} exit=${result.exitCode}`);
  process.exitCode = result.exitCode;
} catch (err) {
  // Only reached if writing the Actions output/summary files fails; report the name, not the message.
  console.error(`collect failed: ${err instanceof Error ? err.name : "unknown error"}`);
  process.exitCode = 1;
}
