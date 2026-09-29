import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { createCloneBudget } from "./public-discovery-clone-budget.mjs";

const config = JSON.parse(fs.readFileSync("data/public-discovery.config.json", "utf8"));
const heads = JSON.parse(fs.readFileSync("data/public-discovery.heads.json", "utf8"));
function budgetSetting(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new Error(`Invalid public discovery clone budget: ${name}`);
  return Number(value);
}
const maxSizeKb = budgetSetting("DEVEX_PUBLIC_DISCOVERY_MAX_SIZE_KB", "512000");
const maxTotalSizeKb = budgetSetting("DEVEX_PUBLIC_DISCOVERY_MAX_CLONE_SIZE_KB", "8388608");
const maxMinutes = budgetSetting("DEVEX_PUBLIC_DISCOVERY_CLONE_MINUTES", "60");
const root = path.resolve("data", "public-discovery-clones");
const budget = createCloneBudget(root, maxSizeKb, maxTotalSizeKb, maxMinutes);

if (!Array.isArray(config.repositories) || !config.repositories.length ||
    Object.keys(heads).length !== config.repositories.length ||
    config.repositories.some((name) =>
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(name) ||
      [".", ".."].includes(name.split("/")[1]) ||
      !/^[a-f0-9]{40}$/.test(heads[name] ?? ""))) {
  throw new Error("Invalid or empty public discovery clone selection and expected heads");
}

fs.mkdirSync(root, { recursive: true });

function git(args, cwd, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, signal, stdio: ["ignore", "ignore", "inherit"] });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`git ${args[0]} exited ${code}`)));
  });
}

async function clone(name) {
  const [owner, repo] = name.split("/");
  const target = path.join(root, owner, repo);
  budget.check(target);
  if (fs.existsSync(target)) throw new Error(`Clone target already exists: ${name}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const controller = new AbortController();
  let abortReason;
  const deadline = setTimeout(() => {
    try {
      budget.check(target, true);
    } catch (error) {
      abortReason = error;
    }
    abortReason ??= new Error(`Public discovery clone of ${name} exceeded its 15-minute time limit`);
    controller.abort();
  }, Math.min(15 * 60_000, budget.remainingMs()));
  const watch = setInterval(() => {
    try {
      budget.check(target, true);
    } catch (error) {
      abortReason = error;
      controller.abort();
    }
  }, 5_000);
  try {
    await git(["clone", "--quiet", "--no-tags", "--", `https://github.com/${name}.git`, target], process.cwd(), controller.signal);
    budget.check(target);
    const head = await new Promise((resolve, reject) => {
      const child = spawn("git", ["rev-parse", "HEAD"], { cwd: target, signal: controller.signal });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Cannot read HEAD of ${name}`)));
    });
    budget.check(target);
    if (head !== heads[name]) throw new Error(`Public discovery ${name} changed HEAD after pinning; refusing the scan`);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw abortReason ?? error;
  } finally {
    clearTimeout(deadline);
    clearInterval(watch);
  }
}

for (const name of config.repositories) await clone(name);
