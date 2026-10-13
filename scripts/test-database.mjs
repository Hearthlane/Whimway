import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const image =
  "postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3";
const name = `whimway-rls-${randomUUID().slice(0, 8)}`;
function docker(args, input) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      result.error?.message ?? result.stderr ?? "Docker command failed",
    );
  return result;
}
try {
  docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "--memory",
    "512m",
    "--cpus",
    "2",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    "POSTGRES_DB=whimway",
    image,
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = spawnSync(
      "docker",
      ["exec", name, "pg_isready", "-U", "postgres", "-d", "whimway", "-q"],
      { timeout: 3000 },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Isolated PostgreSQL did not become ready.");
  const bootstrap = readFileSync(
    new URL("../tests/database/bootstrap.sql", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../supabase/migrations/202610130001_whimway.sql", import.meta.url),
    "utf8",
  );
  const cases = readFileSync(
    new URL("../tests/database/access.sql", import.meta.url),
    "utf8",
  );
  const result = docker(
    [
      "exec",
      "-i",
      name,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "whimway",
    ],
    `${bootstrap}\n${migration}\n${cases}`,
  );
  const passes = (result.stderr.match(/PASS:/g) ?? []).length;
  if (passes < 20)
    throw new Error(`Only ${passes} database assertions executed.`);
  console.log(
    `${passes} PostgreSQL authorization assertions passed. No external ports or live Supabase project were used.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["rm", "--force", "--volumes", name], {
    stdio: "ignore",
    timeout: 10000,
  });
}
