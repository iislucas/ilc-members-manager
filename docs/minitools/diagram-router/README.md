# @ilc/diagram-router

A modular TypeScript library and CLI tool for generating **programmatically routed orthogonal schematic architecture diagrams** (NYC Transit / PCB bus style).

## Key Features

1. **Orthogonal 90-Degree Routing**: Connects node boundary ports with clean Manhattan paths and smooth rounded corners (`Q` quadratic arcs).
2. **Multi-Track Corridor Bundling**: When multiple paths share the same corridor or route part of the way, the bundler automatically assigns symmetric parallel lane offsets (`laneSpacing: 6px`), drawing them side-by-side without visual collision or overlap.
3. **Obstacle-Avoidance Channels**: Calculates clear horizontal and vertical channels between node tiers, preventing lines from crossing node boxes.
4. **Planar Route Optimization**: Eliminates crossings and arrow overlaps across client, cloud functions, third-party platforms, and database layers.

## Project Structure

```
docs/minitools/diagram-router/
├── package.json
├── tsconfig.json
├── src/
│   ├── types.ts              # Node, Port, Edge, and Diagram types
│   ├── geometry.ts           # Port coordinates, rounding, simplification
│   ├── corridor-bundler.ts   # Multi-track parallel lane assignment
│   ├── orthogonal-router.ts  # Manhattan channel path router
│   ├── svg-generator.ts      # Clean SVG path markup generation
│   └── index.ts              # Public library API
├── test/
│   └── router.spec.ts        # Vitest unit test suite
└── scripts/
    └── generate-architecture-diagram.ts  # CLI to generate docs/orders-and-subscriptions.html SVG
```

## Usage

### Run Unit Tests
```bash
pnpm --prefix docs/minitools/diagram-router test
```

### Regenerate System Architecture Diagram
```bash
pnpm --prefix docs/minitools/diagram-router generate
# or from root:
pnpm run generate:diagram
```
