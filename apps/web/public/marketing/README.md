# Marketing assets

Static imagery for the public marketing pages (landing, methods, about, FAQ, footer).
Referenced by URL — `/marketing/<subfolder>/<file>`.

## Layout

- `pipeline/` — overview diagram (sequence → embedding → predictions). Hand-authored SVG.
- `predictions/` — one thumbnail per prediction type, slug matches `content/predictions.ts`.
- `logos/` — Rostlab / TUM / partner marks.
- `locations/` — subcellular-compartment icons (optional; mirrors LambdaPP set, reused under AFL v3.0).

## Conventions

- **SVG preferred** for diagrams and icons — theme via `currentColor`.
- **PNG thumbnails** of actual UI output may replace SVG placeholders; target ≤ 200 KB, 2× retina (1600 px wide for a 800 px card).
- Keep filenames kebab-case and stable; data references them by slug.

## Capturing real screenshots

1. `bun run dev:web` with a running backend stack.
2. Submit the example protein `A0A654IBU3` from the hero input.
3. For each prediction card, scroll to the matching track / panel in the results view and capture a tight crop (browser DevTools device toolbar, 1600 px wide).
4. Save as `predictions/<slug>.png`, compress with `oxipng -o4` or equivalent.

Initial seeds ship as inline SVG illustrations so the site renders without blockers; swap to real PNGs as they are captured.
