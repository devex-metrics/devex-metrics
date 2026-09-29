import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const config = JSON.parse(fs.readFileSync("data/public-discovery.config.json", "utf8"));
const heads = JSON.parse(fs.readFileSync("data/public-discovery.heads.json", "utf8"));
const maxSizeKb = Number(process.env.DEVEX_PUBLIC_DISCOVERY_MAX_SIZE_KB ?? "512000");
const root = path.resolve("data", "public-discovery-clones");

if (!Array.isArray(config.repositories) || !config.repositories.length ||
    !Number.isSafeInteger(maxSizeKb) || maxSizeKb < 0 ||
    Object.keys(heads).length !== config.repositories.length ||
    config.repositories.some((name) =>
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(name) ||
      [".", ".."].includes(name.split("/")[1]) ||
      !/^[a-f0-9]{40}$/.test(heads[name] ?? ""))) {
  throw new Error("Invalid or empty public discovery clone selection and expected heads");
}

function diskBytes(folder) {
  if (!fs.existsSync(folder)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) total += diskBytes(file);
    else if (entry.isFile()) total += fs.statSync(file).size;
  }
  return total;
}

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
  if (fs.existsSync(target)) throw new Error(`Clone target already exists: ${name}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const controller = new AbortController();
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15 * 60 * 1000);
  let oversized = false;
  const budget = maxSizeKb ? maxSizeKb * 1024 * 2 : 0;
  const watch = setInterval(() => {
    if (budget && diskBytes(target) > budget) {
      oversized = true;
      controller.abort();
    }
  }, 10_000);
  try {
    await git(["clone", "--quiet", "--no-tags", "--", `https://github.com/${name}.git`, target], process.cwd(), controller.signal);
    if (budget && diskBytes(target) > budget) throw new Error(`Full-history checkout of ${name} exceeds ${budget} bytes on disk`);
    const head = await new Promise((resolve, reject) => {
      const child = spawn("git", ["rev-parse", "HEAD"], { cwd: target });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Cannot read HEAD of ${name}`)));
    });
    if (head !== heads[name]) throw new Error(`Public discovery ${name} changed HEAD after pinning; refusing the scan`);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (oversized) throw new Error(`Full-history checkout of ${name} exceeded its on-disk budget`);
    if (timedOut) throw new Error(`Full-history checkout of ${name} timed out`);
    throw error;
  } finally {
    clearTimeout(deadline);
    clearInterval(watch);
  }
}

for (const name of config.repositories) await clone(name);
