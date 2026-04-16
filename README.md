# 7plus-browser

A 7plus encoder/decoder in the browser.

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

Produces `dist/` containing `index.html` plus a hashed JS+CSS bundle (~14 kB total, ~5.5 kB gzipped).

### Deploy

Upload the contents of `dist/` to any static host:

- **nginx / Apache**: copy `dist/*` into the document root.
- **GitHub Pages**: push `dist/` to the `gh-pages` branch (or configure Pages to serve from a `/docs` folder).
- **S3 / Cloudflare R2 / Netlify / Vercel**: point the static-site deployment at `dist/`.
- **Local / offline**: open `dist/index.html` directly — works from `file://` in most browsers.

No server-side configuration is required beyond serving static files with the usual MIME types.

### Cutting a release

`.github/workflows/release.yml` builds and publishes a GitHub release whenever the version in `package.json` changes. Workflow:

1. Bump the `version` field in `package.json` (semver — e.g. `0.1.0` → `0.2.0`).
2. Commit and push to `main`.
3. CI runs tests, builds `dist/`, and publishes a release tagged `v<version>` with `7plus-browser-v<version>.zip` and `.tar.gz` attached.

Pushes that don't bump the version still run tests and build, but skip the release step (so you get CI coverage without tag noise).
