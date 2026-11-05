# Badge logo credits

Logo paths are checked into `data/badge-logos.json` and embedded into each badge.
The registry records the exact upstream SVG URL and revision for each vendored
mark, plus source guidelines and per-icon license metadata where supplied.

- Simple Icons paths use the CC0-1.0 distribution. Most use revision
  `4bfa9da744e2c06928047314ce30dc5c8d1ad759`; removed marks use pinned
  releases 12.0.0 and 8.0.0. See [the CC0 notice](SIMPLE-ICONS-LICENSE.md).
- Ghidra and OpenCL paths come from Devicon revision
  `32fe1d3b3f36ad11f90ab94f7db59738139c2bf6`.
  See [the MIT notice](DEVICON-LICENSE.txt).
- JAX uses the polygons in its official project logo, converted to a single
  monochrome path. See [the Apache-2.0 notice](JAX-LICENSE.txt).
- Valkey uses its official website's pinned-tab mark, with its original coordinate
  transform. See [the BSD-3-Clause notice](VALKEY-LICENSE.txt).
- Category symbols with `source: original` were drawn for these badges. They
  identify concepts such as databases, networks, instruction sets and terminals;
  they are not claimed to be official project logos.

Marks use a shared 14px slot and theme-adjusted colors. Brand names and marks
belong to their respective owners. The source licenses and any brand-specific
metadata are retained separately from the badge renderer.
