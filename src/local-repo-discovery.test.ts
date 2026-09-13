import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseGitHubRemote, discoverLocalRepos } from "./local-repo-discovery.js";

describe("parseGitHubRemote", () => {
  it("parses the SSH shorthand form", () => {
    expect(parseGitHubRemote("git@github.com:acme-corp/acme-app.git")).toEqual({
      owner: "acme-corp",
      name: "acme-app",
    });
  });

  it("parses the SSH shorthand form without a .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:my-org/my-repo")).toEqual({
      owner: "my-org",
      name: "my-repo",
    });
  });

  it("parses an https URL", () => {
    expect(parseGitHubRemote("https://github.com/my-org/my-repo.git")).toEqual({
      owner: "my-org",
      name: "my-repo",
    });
  });

  it("parses an https URL without a .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/my-org/my-repo")).toEqual({
      owner: "my-org",
      name: "my-repo",
    });
  });

  it("parses an ssh:// URL with a user segment", () => {
    expect(parseGitHubRemote("ssh://git@github.com/my-org/my-repo.git")).toEqual({
      owner: "my-org",
      name: "my-repo",
    });
  });

  it("returns null for a non-GitHub remote", () => {
    expect(parseGitHubRemote("https://gitlab.com/my-org/my-repo.git")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseGitHubRemote("not a url")).toBeNull();
  });
});

describe("discoverLocalRepos", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeRepo(root: string, name: string, originUrl: string | null): void {
    const repoPath = path.join(root, name);
    const gitDir = path.join(repoPath, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    if (originUrl !== null) {
      fs.writeFileSync(
        path.join(gitDir, "config"),
        `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${originUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`
      );
    } else {
      fs.writeFileSync(path.join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");
    }
  }

  it("discovers repos with a recognizable GitHub origin", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-metrics-test-"));
    makeRepo(tmpDir, "repo-a", "git@github.com:acme-corp/repo-a.git");
    makeRepo(tmpDir, "repo-b", "https://github.com/acme-corp/repo-b.git");

    const result = discoverLocalRepos(tmpDir);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.name === "repo-a")).toEqual({
      owner: "acme-corp",
      name: "repo-a",
      localPath: path.join(tmpDir, "repo-a"),
    });
    expect(result.find((r) => r.name === "repo-b")?.owner).toBe("acme-corp");
  });

  it("skips non-git directories", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-metrics-test-"));
    fs.mkdirSync(path.join(tmpDir, "not-a-repo"));

    expect(discoverLocalRepos(tmpDir)).toHaveLength(0);
  });

  it("skips repos without an origin remote", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-metrics-test-"));
    makeRepo(tmpDir, "no-origin", null);

    expect(discoverLocalRepos(tmpDir)).toHaveLength(0);
  });

  it("skips repos whose origin isn't a GitHub URL", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-metrics-test-"));
    makeRepo(tmpDir, "gitlab-repo", "https://gitlab.com/my-org/my-repo.git");

    expect(discoverLocalRepos(tmpDir)).toHaveLength(0);
  });
});
