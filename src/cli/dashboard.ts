import { runDashboard } from "../dashboard/run.js";

try {
  process.exitCode = await runDashboard(process.argv.slice(2), {
    cwd: process.cwd(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
} catch (err) {
  console.error(`dashboard failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
