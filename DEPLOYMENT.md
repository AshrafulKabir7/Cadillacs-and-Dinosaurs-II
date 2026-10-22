# Hosting Fessenden's Legacy

This is a static HTML/CSS/JavaScript game. Its entry point is `index.html` at the repository root. It needs no backend, database, environment variables, dependency installation or build step.

## Before pushing

The art and data the game loads are generated files, and they are committed: `sprite-data-*.js`, `stage-data.js`, `assets/stages/**` and `combat-config.js`. Vercel and GitHub Pages serve them as they are, so a stale generated file would ship. After changing `combat-config.json`, a stage recipe in `tools/re/levels/` or anything under `tools/re/build/`, rebuild and check before pushing:

```text
node tools/re/build-game-assets.cjs all
node tools/re/build-game-assets.cjs check
node tests/assets.cjs
```

`check` (it needs the ROM set and the research extracts, which stay outside the repository) fails on any difference between the shipped files and a fresh build, and on the budgets: at most 3.5 MB loaded at start-up (audio aside), 1.5 MB per file, 1 MB of stage pages per chapter. A change to `combat-config.json` alone needs only `node tools/build-config.cjs`.

## Vercel

1. Open [Vercel's new-project page](https://vercel.com/new) and sign in with your GitHub account.
2. Import **AshrafulKabir7/Cadillacs-and-Dinosaurs-II**. If it is not listed, grant the Vercel GitHub integration access to this repository.
3. Use these settings, then click **Deploy**:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | **Other** |
| Root directory | Repository root (`./`) |
| Build command | Leave empty |
| Install command | Leave empty |
| Output directory | `.` |
| Environment variables | None |

`vercel.json` already supplies the framework, build, install and output settings. Do not choose Next.js, React or Vite; this game serves its existing files directly. `.vercelignore` keeps everything that is not the game out of the deployment: the documentation (`*.md`, `docs/`), the Windows launcher, `tests/`, `tools/`, `work/`, `design/`, `combat-config.json`, `assets/reference/`, the audio manifest, the reference videos, and the legacy art files retired in G8 (listed there so a copy that comes back is never served).

Online co-op (PLAY WITH FRIENDS) needs nothing from the deployment: `net.js`, `lobby.js` and `lobby.css` ship with the game (the page loads them only when PLAY WITH FRIENDS is chosen or a `?join=` link is opened), and PeerJS 1.5.4 is fetched from jsDelivr (unpkg as the fallback) only when a player chooses Host or Join. Players are introduced by the free public PeerJS broker (`0.peerjs.com`); if it or jsDelivr is unreachable, online play shows an error and single-player is unaffected. `vercel.json` sets no Content-Security-Policy, so nothing blocks the script or WebRTC.

After the repository is connected, pushes to `main` trigger production updates. Vercel supplies the final `*.vercel.app` address when deployment completes. No production deployment or project has been created automatically by this repository preparation.

Vercel's [Hobby plan](https://vercel.com/docs/plans/hobby) is a free option for personal, non-commercial projects, subject to its published limits and terms.

Official references: [static build settings](https://vercel.com/docs/builds/configure-a-build), [vercel.json configuration](https://vercel.com/docs/project-configuration/vercel-json), [Git deployments](https://vercel.com/docs/git).

## Free alternative: GitHub Pages

For this public repository, GitHub Pages can serve the same files without a build tool:

1. Open the repository's [Pages settings](https://github.com/AshrafulKabir7/Cadillacs-and-Dinosaurs-II/settings/pages).
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose **main**, choose **/ (root)**, then save.
4. Wait for GitHub's Pages deployment to finish. The expected project address is `https://ashrafulkabir7.github.io/Cadillacs-and-Dinosaurs-II/`; it becomes usable only after Pages is enabled and deployment succeeds.

`.nojekyll` is included for direct static-file hosting. All game asset paths are relative, so they also work under the repository-name path used by GitHub Pages.

Official references: [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages), [publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Local preview

Open `index.html`, or run `node tools/serve.cjs 8766` from the repository and visit `http://127.0.0.1:8766`. The Windows `PLAY GAME.bat` launcher opens the local HTML file.

Progress is saved on the player's browser and site origin. Your local-file save, Vercel save and GitHub Pages save are separate. Clearing browser storage resets progress. Audio starts after a click or keypress; fullscreen and controllers depend on browser support.

The project includes recovered original arcade artwork and retains its original attribution. This is an unofficial fan game.
