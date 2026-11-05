# Profile asset generation

All generators use runtime APIs only. No package installation is needed.

```sh
bun scripts/generate-badges.mjs
bun scripts/generate-language-chart.mjs --from-stats
bun test scripts/generators.test.mjs
```

The badges are original text-only SVGs generated from `data/badges.json`. They
use a shared 28px height, 6px corners, proportional 12px text and neutral surfaces.
The previous colors appear as small brand markers. Each SVG follows the viewer's
light or dark theme, with text contrast above 4.5:1 in both modes.
They contain no third-party logos, remote fonts or image requests.
To add a badge, add its filename, label and six-digit color to the JSON and link
the generated file from Markdown.

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
