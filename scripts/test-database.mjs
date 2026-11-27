import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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
const sql = () => {
  const read = (u) => readFileSync(new URL(u, import.meta.url), "utf8");
  const bootstrap = read("../tests/database/bootstrap.sql");
  // Every migration, in filename (timestamp) order, exactly as a fresh project would apply them.
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const migration = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
  const cases = ["access.sql", "community.sql", "billing.sql", "sponsored.sql"]
    .map((f) => read(`../tests/database/${f}`))
    .join("\n");
  return `${bootstrap}\n${migration}\n${cases}`;
};
const report = (stderr) => {
  const passes = (stderr.match(/PASS:/g) ?? []).length;
  if (passes < 75)
    throw new Error(`Only ${passes} database assertions executed.`);
  console.log(
    `${passes} PostgreSQL authorization assertions passed. No live Supabase project was used.`,
  );
};

// Without Docker: TEST_DATABASE_ADMIN_URL=postgres://user@host/postgres npm run test:db
// creates a throwaway database on that server, runs everything, and drops it.
const admin = process.env.TEST_DATABASE_ADMIN_URL;
if (admin) {
  const db = `whimway_test_${randomUUID().slice(0, 8)}`;
  const psql = (url, input, args = []) =>
    spawnSync(
      "psql",
      ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", url, ...args],
      {
        encoding: "utf8",
        input,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  const target = admin.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);
  try {
    const created = psql(admin, undefined, ["-c", `create database ${db}`]);
    if (created.status !== 0)
      throw new Error(created.stderr || "Could not create a test database.");
    const result = psql(target, sql());
    if (result.status !== 0)
      throw new Error(
        result.stderr
          .split("\n")
          .filter((l) => /ERROR|FAILED/.test(l))
          .join("\n") || "psql failed",
      );
    report(result.stderr);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    psql(admin, undefined, ["-c", `drop database if exists ${db}`]);
  }
} else
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
      sql(),
    );
    report(result.stderr);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    spawnSync("docker", ["rm", "--force", "--volumes", name], {
      stdio: "ignore",
      timeout: 10000,
    });
  }
