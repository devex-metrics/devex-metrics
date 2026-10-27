import { spawnSync } from "node:child_process";
import * as path from "node:path";

describe("installed public discovery scanner", () => {
  it("distinguishes owner containers from genuinely ambiguous checkout roots", () => {
    const scanner = path.resolve(
      "node_modules",
      "@devex-metrics",
      "repo-landscape",
      "python",
      "landscape.py"
    );
    const script = `
import importlib.util
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("landscape", sys.argv[1])
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary).resolve()
    nested = root / "acme" / "acme"
    (nested / ".git").mkdir(parents=True)

    def metadata(checkout, *args, **kwargs):
        if args == ("rev-parse", "--show-toplevel"):
            return str(checkout)
        if args == ("rev-parse", "--is-shallow-repository"):
            return "false"
        if args == ("remote", "get-url", "origin"):
            return "https://github.com/acme/acme.git"
        if args == ("symbolic-ref", "--short", "HEAD"):
            return "main"
        if args in (("rev-parse", "HEAD"),
                    ("rev-parse", "--verify", "refs/remotes/origin/main")):
            return "a" * 40
        raise AssertionError(f"Unexpected Git metadata request: {args}")

    with patch.object(scanner, "git_text", side_effect=metadata):
        assert scanner.local_checkout(root, "acme/acme") == nested
        (root / "acme" / ".git").mkdir()
        try:
            scanner.local_checkout(root, "acme/acme")
        except scanner.ScanError as error:
            assert "ambiguous" in str(error), str(error)
        else:
            raise AssertionError("Two actual checkout roots must remain ambiguous")
`;
    const python =
      process.env.REPO_LANDSCAPE_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const result = spawnSync(python, ["-c", script, scanner], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
