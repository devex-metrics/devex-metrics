import { loadConfig } from "./config.js";
import { landscapeRosterKey, resolveLandscapeTeam } from "./landscape-team.js";

describe("landscape commit roster", () => {
  it("uses the focus roster and display name without requiring a team configuration", () => {
    const config = loadConfig({
      DEVEX_FOCUS_NAME: "Example group", DEVEX_FOCUS_USERS: "alice_acme,bob_acme",
    });
    expect(config.team).toBeUndefined();
    expect(resolveLandscapeTeam(config)).toEqual({
      name: "Example group", handles: ["alice_acme", "bob_acme"],
      key: landscapeRosterKey(["alice_acme", "bob_acme"]),
    });
  });

  it("keeps a nonempty explicit team roster and the existing Team label ahead of the focus group", () => {
    const config = loadConfig({
      DEVEX_TEAM_HANDLES: "carol", DEVEX_TEAM_NAME: "Platform",
      DEVEX_FOCUS_NAME: "Example group", DEVEX_FOCUS_USERS: "alice",
    });
    expect(resolveLandscapeTeam(config)).toEqual({
      name: "Team", handles: ["carol"], key: landscapeRosterKey(["carol"]),
    });
    config.team!.handles = [];
    expect(resolveLandscapeTeam(config)).toMatchObject({
      name: "Example group", handles: ["alice"],
    });
  });

  it("does not invent a roster or borrow an unrelated team name", () => {
    const config = loadConfig({ DEVEX_TEAM_NAME: "Repository scope" });
    expect(resolveLandscapeTeam(config)).toEqual({ name: "Team", handles: [], key: undefined });
  });

  it("compares membership case-insensitively and independently of order, but detects roster changes", () => {
    expect(landscapeRosterKey(["Alice", "bob", "alice"])).toBe(landscapeRosterKey(["BOB", "alice"]));
    expect(landscapeRosterKey(["alice"])).not.toBe(landscapeRosterKey(["alice", "bob"]));
    expect(landscapeRosterKey([])).toBeUndefined();
  });
});
