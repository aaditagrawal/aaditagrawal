# Profile asset generation

All generators use runtime APIs only. No package installation is needed.

```sh
bun scripts/generate-badges.mjs
bun scripts/generate-language-chart.mjs --from-stats
bun test scripts/generators.test.mjs
```

Badges use local SVG logos and labels from `data/badges.json` and
`data/badge-logos.json`. They share a 28px height, 6px corners, 14px logo slot,
natural-width 12px text and neutral surfaces. Brand colors adjust for at least
3:1 logo contrast in each theme; text contrast stays above 4.5:1.

The catalog contains 160 brand marks and 24 original category symbols for
entries without a dedicated mark in the catalog. Related components can share
their parent project's logo. All paths are embedded directly in the generated
SVGs; viewing or regenerating them needs no image service, font download or
package installation. Pinned sources and license notices are in
[the logo credits](../assets/logos/README.md).

To add a badge, add its filename, label and six-digit color to `data/badges.json`,
map it to an icon in `data/badge-logos.json`, and link the generated SVG from Markdown.

`--from-stats` renders the saved `data/language-stats.json` without a token or
network access. It preserves the snapshot timestamp and statistics, and generates
light/dark charts in desktop and compact layouts. The README selects the two-column compact
legend below 600px. Long-tail language notes wrap instead of shrinking to fit.
Typography, corner radii and theme colors come from `scripts/visual-style.mjs`.
It does not refresh repository counts or language totals.

For fresh account-wide statistics, set `GITHUB_TOKEN` in the environment and run:

```sh
bun scripts/generate-language-chart.mjs
```

The default mode still uses GitHub's repository and language APIs, excludes forks
and archives, and adds `data/extra-languages.json`. The token needs access to the
private repositories to include them. Only aggregate language statistics are
published. GitHub still hosts the profile and its chart images.

Both generators also run with Node.js 18 or newer in place of `bun`.

## Performance checks

```sh
bun scripts/benchmark-chart.mjs
bun scripts/benchmark-badges.mjs
```

These opt-in benchmarks compare against committed source at `b40edbd` and print
JSON with repeated alternating samples and distributions. `SAMPLES` overrides
the sample count. Run them sequentially on an otherwise idle machine.

The chart benchmark uses identical mocked API responses, verifies statistics
against the baseline, and checks that the current online/offline modes produce
identical SVGs in all four layouts. It reports CPU time, generator wall time and
full process time separately. The badge benchmark needs an installed Chrome, selected with
`BROWSER_BIN`. It caches original Shields SVGs outside the repository as
benchmark-only fixtures, then measures cached image rendering and DOM layout
without network requests. Chrome is unnecessary for generating or viewing the
profile assets. Network acquisition and browser startup are separate from the
render samples.
