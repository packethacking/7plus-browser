# 7plus-browser

A 7plus encoder/decoder in the browser.

A hosted instance is available at <https://static.m0ouk.compute.oarc.uk/7plus> if you'd rather not build or host it yourself.

AI-built based on https://github.com/hb9xar/7plus as reference and verified against 7plus.exe version 2.21 (990411) by Axel Bauda, DG1BBQ

No formal licence is specified by Axel other than `* no commercial use * no sale * circulate freely *` so take that as you will.

## Building and deploying

The app is a fully static site — all encoding/decoding runs in the browser, there is no backend. Hosting is just a matter of serving the files in `dist/` from any static web server (nginx, Apache, S3, GitHub Pages, a USB stick, etc).

**You can grab a release from the Releases section** or follow the instructions below to build it yourself.

### Prerequisites

You need Node.js (22 or newer) and `npm`, which is only used for build tooling — `vite` to bundle and `typescript`/`vitest` for checks. The built output is plain HTML/JS/CSS with no runtime dependency on Node.

Install via [nvm](https://github.com/nvm-sh/nvm):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# then in a new shell:
nvm install 22
```

Or via your distro's package manager (e.g. `apt install nodejs npm`, `brew install node`).

### Install dependencies

From the repo root:

```sh
npm install
```

### Develop

```sh
npm run dev
```

Starts a Vite dev server at <http://127.0.0.1:5173/> with hot reload.

### Test

```sh
npm test
```

Runs the 22-test Vitest suite: CRC goldens, byte-identical encode against reference output, decode round-trips, and a zip writer check. Requires the `sample-data/` fixtures to be present.

### Build for production

```sh
npm run build
```

Produces `dist/index.html` — a single self-contained HTML file with JS and CSS inlined (~20 kB, ~8 kB gzipped). No sibling assets.

### Deploy

Copy `dist/index.html` anywhere that serves static files — or just open it locally:

- **nginx / Apache**: drop it into the document root (or any subfolder).
- **GitHub Pages / S3 / Cloudflare R2 / Netlify / Vercel**: upload the single file.
- **Local / offline**: open `dist/index.html` directly — works from `file://`, a USB stick, an email attachment.

Because JS and CSS are inlined, there are no sibling paths to resolve, so it works regardless of subfolder depth, trailing-slash quirks, or URL rewrites.

### Cutting a release

`.github/workflows/release.yml` builds and publishes a GitHub release whenever the version in `package.json` changes. Workflow:

1. Bump the `version` field in `package.json` (semver — e.g. `0.1.0` → `0.2.0`).
2. Commit and push to `main`.
3. CI runs tests, builds, and publishes a release tagged `v<version>` with a single `7plus-browser-v<version>.html` file attached.

Pushes that don't bump the version still run tests and build, but skip the release step (so you get CI coverage without tag noise).
