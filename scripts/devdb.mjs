/* Dev database controller — a private PostgreSQL 18 cluster living in .pgdata/
   on port 5544, completely separate from any system-wide Postgres service.
   Uses the binaries from a standard PostgreSQL install (PGBIN overrides).

     npm run db          start (initializes on first run, creates the database)
     npm run db:stop     stop
*/

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { execSync } from "node:child_process";

/** PGBIN wins; otherwise the standard Windows install dir, or whatever
    pg_ctl the PATH knows about on Unix. */
function findPgBin() {
  if (process.env.PGBIN) return process.env.PGBIN;
  if (process.platform === "win32") return "C:\\Program Files\\PostgreSQL\\18\\bin";
  try {
    return path.dirname(execSync("command -v pg_ctl || ls -d /usr/lib/postgresql/*/bin/pg_ctl | tail -1", { shell: "/bin/sh", encoding: "utf8" }).trim());
  } catch {
    return "/usr/bin";
  }
}
const PGBIN = findPgBin();
const DATA = path.resolve(".pgdata");
const PORT = process.env.PGPORT || "5544";
const DB = "absence_ops";

const bin = (name) => path.join(PGBIN, name + (process.platform === "win32" ? ".exe" : ""));
const run = (name, args, opts = {}) =>
  execFileSync(bin(name), args, { stdio: "inherit", ...opts });

const cmd = process.argv[2] || "start";

if (!existsSync(bin("pg_ctl"))) {
  console.error(`PostgreSQL binaries not found at ${PGBIN} — set PGBIN to your install's bin directory.`);
  process.exit(1);
}

if (cmd === "start") {
  if (!existsSync(DATA)) {
    console.log("First run — initializing private cluster in .pgdata …");
    run("initdb", ["-D", DATA, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-instructions"]);
  }
  try {
    run("pg_ctl", ["-D", DATA, "-o", `-p ${PORT}`, "-l", path.join(DATA, "log.txt"), "-w", "start"]);
  } catch {
    console.log("(already running?)");
  }
  try {
    execFileSync(bin("createdb"), ["-h", "localhost", "-p", PORT, "-U", "postgres", DB], { stdio: "pipe" });
    console.log(`Created database ${DB}.`);
  } catch {
    /* exists — fine */
  }
  console.log(`PostgreSQL ready on localhost:${PORT}, database ${DB}.`);
} else if (cmd === "stop") {
  run("pg_ctl", ["-D", DATA, "stop", "-m", "fast"]);
} else {
  console.error(`Unknown command "${cmd}" — use start or stop.`);
  process.exit(1);
}
