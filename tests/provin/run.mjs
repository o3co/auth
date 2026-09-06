import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// npm_execpath also lets local callers select an already installed pnpm CLI.
const cli = process.env.npm_execpath;
const root = resolve(import.meta.dirname, "../..");
const consumer = resolve(root, "repos/provin.auth");
// Generated workspaces from an earlier run must not enter the source test pass.
rmSync(resolve(consumer, "instances"), { recursive: true, force: true });
const artifacts = resolve(consumer, ".auth-compatibility");
mkdirSync(artifacts, { recursive: true });
function pnpm(cwd, ...args) {
  execFileSync(cli ? process.execPath : "pnpm", cli ? [cli, ...args] : args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, npm_config_manage_package_manager_versions: "false" },
  });
}

// Pack the real build output. pnpm pack rewrites workspace:* dependencies;
// overrides then replace every upstream dependency, including transitive ones.
// Directories are relative to the cloned repo root, because auth.utils is a
// single-package repo rather than a workspace. It ships as its own npm package
// that provider/verifier depend on and the consumer imports directly, so an
// override list without it would test candidate components against a released
// utils — the one family package the pins would not cover.
const packages = [
  ["auth.utils", "."],
  ["auth.provider", "packages/core"],
  ["auth.provider", "packages/oauth"],
  ["auth.policy-verifier", "packages/core"],
  ["auth.policy-verifier", "packages/builtins"],
  ["auth.policy-verifier", "packages/server"],
];
const manifestPath = resolve(consumer, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.pnpm ??= {};
manifest.pnpm.overrides ??= {};
for (const [repo, directory] of packages) {
  const cwd = resolve(root, "repos", repo, directory);
  const { name, version } = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  pnpm(cwd, "pack", "--pack-destination", artifacts);
  const archive = `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
  manifest.pnpm.overrides[name] = `file:./.auth-compatibility/${archive}`;
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// The consumer's original lock remains the baseline for other dependencies.
// Only this disposable checkout is changed; no package or image is published.
pnpm(consumer, "install", "--no-frozen-lockfile");
pnpm(consumer, "-r", "run", "build");
pnpm(consumer, "-r", "--if-present", "run", "typecheck");
pnpm(consumer, "-r", "run", "test");

// Also exercise generated composition roots: their configuration and explicit
// module wiring are a separate contract from the hand-built integration fixture.
const ref = execFileSync("git", ["rev-parse", "HEAD"], { cwd: consumer, encoding: "utf8" }).trim();
for (const [generator, name] of [
  ["create-provider", "provider"],
  ["create-policy-verifier", "policy-verifier"],
]) {
  execFileSync(process.execPath, [
    `packages/${generator}/dist/cli.mjs`, name,
    "--dplaax-module-ref", ref, "--out", `instances/${name}`, "--no-git-init",
  ], { cwd: consumer, stdio: "inherit" });
}
pnpm(consumer, "install", "--no-frozen-lockfile");
for (const task of ["build", "typecheck", "test"]) {
  pnpm(consumer, "--filter", "./instances/*", "--if-present", "run", task);
}
for (const [name, port, path] of [
  ["provider", "3000", "/_healthcheck"],
  ["policy-verifier", "3001", "/healthcheck"],
]) {
  execFileSync("bash", ["scripts/smoke-instance.sh", `instances/${name}`, port, path],
    { cwd: consumer, stdio: "inherit" });
}
execFileSync(process.execPath, ["scripts/smoke-did-grant.mjs", "instances/provider", "3100"],
  { cwd: consumer, stdio: "inherit" });
