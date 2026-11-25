# Reproducible builds

Every npm release of `@saihm/mcp-server` from `0.3.6` onward was built in CI
from its git tag, so it can be rebuilt and compared byte for byte with the
tarball npm serves. The
package holds compiled JavaScript and type declarations in `dist/`, plus
`package.json`, `LICENSE`, `README.md`, `llms-install.md` and `CHANGELOG.md`.
Nothing is bundled or minified.

## How a release is built

[`release.yml`](.github/workflows/release.yml) runs when a GitHub Release is
published. It checks out the release tag, sets up Node.js 24
(`node-version: '24'`), installs dependencies with `npm ci` from the committed
`package-lock.json`, runs `npm run build` (`rm -rf dist coverage`,
`tsc -p .`, `chmod +x dist/saihm_mcp_server.js`) and, once the typecheck
and tests pass, `npm publish`. The
lockfile pins the TypeScript compiler for each tag (6.0.3 at `v0.3.17`). The
workflow also upgrades npm, which trusted publishing needs; the npm version
made no difference in the checks below.

Releases `0.1.0` through `0.3.5` were published by hand, before this
workflow existed, and are not covered here.

## Rebuild and compare

You need git, Node.js 20 or later with its bundled npm, and network access to
GitHub and the npm registry. Set `VERSION` to the release you want to check.

```sh
VERSION=0.3.17
WORK="$(mktemp -d)"
mkdir -p "$WORK/rebuilt" "$WORK/published"

git clone --depth 1 --branch "v$VERSION" \
  https://github.com/SAIHM-Admin/saihm-mcp.git "$WORK/src"
cd "$WORK/src"
npm ci
npm run build
npm pack --pack-destination "$WORK/rebuilt"

cd "$WORK/published"
npm pack "@saihm/mcp-server@$VERSION"
```

The explicit `npm run build` matches `release.yml`. Tags before `v0.3.11`
have no `prepack` script, so `npm pack` alone would leave `dist/` out of the
rebuilt tarball; on later tags the second build is harmless.

Compare the two tarballs, then their contents:

```sh
cd "$WORK"
sha256sum rebuilt/*.tgz published/*.tgz    # macOS: shasum -a 256

mkdir x-rebuilt x-published
tar -xzf rebuilt/*.tgz -C x-rebuilt
tar -xzf published/*.tgz -C x-published
diff -r x-rebuilt/package/dist x-published/package/dist && echo "dist/ identical"
diff -r x-rebuilt/package x-published/package && echo "package identical"
```

To tie the published tarball to the tag, check that npm's recorded commit is
the one you built:

```sh
npm view "@saihm/mcp-server@$VERSION" gitHead
git -C "$WORK/src" rev-parse HEAD
```

## Results

Checked on 2026-11-25 with the commands above:

- All twelve CI-built releases, `0.3.6` through `0.3.17`, rebuilt to
  tarballs byte-identical to the ones npm serves, on Node.js 24.20.0 with
  npm 11.19.0.
- `0.3.17` was also rebuilt on Node.js 22.22.2 (npm 10.9.7) and 20.20.2
  (npm 10.8.2), with the same byte-identical result.

For `0.3.17` the rebuilt tarball's SHA-256 is
`20252085ebd3efff2de6a53951ed45f22fc9dc2dd48ccbd1baf91efe5f5c6f86`, its
SHA-512 equals the `dist.integrity` value npm publishes for that version, and
npm's `gitHead` is the tag commit `af9a4e0b3b453bce21465704407dea9c394cd6f5`.

## Known nondeterminism

None observed. The reasons it holds:

- `tsc` output depends only on the sources, `tsconfig.json` and the compiler
  version, and the lockfile pins the compiler. The build embeds no
  timestamps, absolute paths or host details, and emits no source maps.
- `npm pack` writes entries in a fixed order, stamps every entry
  1985-10-26 08:15 UTC with owner `0/0`, and normalizes permissions to
  `0644`, or `0755` for the executable entry point. The archive therefore does
  not depend on the build machine's clock, user or umask.
- The gzip layer comes from Node.js's bundled zlib. It produced identical
  bytes on Node.js 20, 22 and 24, but a future zlib could compress the same
  archive differently. If the `.tgz` hashes ever differ, the `diff -r`
  comparison of the extracted files is the one that counts.

## Automated check

[`reproducible-build.yml`](.github/workflows/reproducible-build.yml) runs the
same procedure on Node.js 24. It starts on every `v*.*.*` tag push and waits up
to 30 minutes for npm to serve the new version. You can also start it by hand
for any published version:

```sh
gh workflow run reproducible-build.yml -f version=0.3.17
```

The job fails if the extracted contents or the archive entries differ. A
difference only in the compressed bytes is reported as a notice. The job is
optional: it publishes nothing and does not gate releases.
