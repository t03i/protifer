# protifer Web

React 19 + Vite + TanStack Router frontend for protein prediction and analysis.

## Dev commands

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `bun run dev`       | Start dev server (port 3000) |
| `bun run build`     | Production build             |
| `bun run test`      | Run Vitest                   |
| `bun run typecheck` | TypeScript check             |
| `bun run lint`      | ESLint                       |
| `bun run check`     | Prettier + ESLint fix        |

## Structure

```
src/
├── components/         # Shared UI
│   ├── layout/         # Header, Footer, RootLayout
│   ├── landing/        # HeroInput, HowItWorks, PredictionCarousel, …
│   ├── ui/             # shadcn primitives (button, card, dialog, …)
│   └── error/          # AppErrorBoundary, ErrorFallback
├── features/           # Feature modules
│   ├── input/          # SequenceInput, SequenceDisplay, ValidationIndicator
│   ├── predictions/    # PredictionResults (secondary structure, disorder, GO, …)
│   ├── interactive/    # NightingaleViewer (tracks, conservation)
│   ├── structure/      # MolstarViewer, StructurePanel (3D)
│   ├── enrichment/     # UniProtEnrichment
│   ├── uniref/         # UniRefClusters, FoldSeekLink
│   └── status/         # ServiceStatus
├── services/           # API clients, transforms
│   ├── api/            # BiocentrAL, UniProt, UniRef, Beacons
│   ├── sequence/       # Parser, validation
│   └── transform/      # Features, GO terms, Nightingale data
├── routes/             # File-based TanStack Router
└── store/              # Redux (selection state)
```
