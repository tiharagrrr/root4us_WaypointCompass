# Linear and GitHub

Tasks live in the Linear project [Waypoint Compass · Hackathon Build](https://linear.app/root4us/project/waypoint-compass-hackathon-build-2a91249f70e7) (team **Root4us**, issue keys `ROO-<n>`). Each issue links the Build Spec section and the acceptance criteria (`AC-…`) it delivers. Milestones are the daily gates, Wed 30 Sep to Sun 4 Oct.

## Team

| Person | Linear | GitHub | Owner label |
| --- | --- | --- | --- |
| Nimesha | nimesha.periyap | nimeshaperi | Nimesha |
| Tihara | tiharaeg (tweeg) | tiharagrrr (repo owner) | Tihara |
| Harini | wathmademel | Hariniii44 | Harini |
| Aniqa | not invited yet | ANIQA25 | Aniqa |

Every issue is assigned to its Owner label's person. The exception is Aniqa: those issues stay unassigned until Aniqa joins Linear.

## Setup

1. **GitHub integration: connected (30 Sep).** The Linear app is installed on `tiharagrrr/root4us_WaypointCompass`. Linear links any branch, commit or PR that carries a `ROO-<n>` ID to that issue.
2. **PR automations** (Settings → Teams → Root4us → Workflow → Pull request and commit automation) should read:

   | GitHub event | Linear status |
   | --- | --- |
   | Branch or draft PR opened | In Progress |
   | PR opened / review requested | In Review |
   | PR merged | Done |

3. **Link your GitHub account** (each person, once): Linear → Settings → Account → Connected accounts → GitHub. This lets Linear attribute your PRs, commits and reviews to you.
4. **Invite Aniqa** (a Linear admin: Settings → Members), then assign every issue labelled **Aniqa** to Aniqa.

## Daily flow

1. Pick an issue in Linear and move it to In Progress (or just open the branch).
2. Copy the branch name from the issue (`Cmd/Ctrl + Shift + .`), or name it `<type>/roo-<n>-<short>`, e.g. `feat/roo-19-ordering-submit`. Linear links any branch whose name contains the issue ID.
3. Commit with Conventional Commits, e.g. `feat(ordering): submit order before cutoff`. Adding `ROO-19` to a commit message links the commit too.
4. Open the PR from the template. Keep `Closes ROO-19` so the issue closes on merge; use `Refs ROO-19` for partial work. The `Linear` check fails if the branch, title and body carry no issue ID.
5. Bugs found during a gate check or the bug bash get their own issue with the `Bug` label.

## Labels

| Group | Labels | Use |
| --- | --- | --- |
| Owner | Nimesha, Tihara, Aniqa, Harini | Slice owner from the Build Spec |
| Area | Backend, Frontend, Engine, Infra, Docs & demo | Part of the repo touched |
| — | Judge path | On the numbered judge walkthrough; finish and polish first |
| — | Stretch | Only if the day's gate is green |
