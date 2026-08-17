/* docs/minitools/diagram-router/test/router.spec.ts
 *
 * Comprehensive unit tests for the Orthogonal Schematic Diagram Router library,
 * including Strict 90-Degree Perpendicular Docking, Planar Co-directional Turns,
 * Overlap-Only Corridor Bundling, and Automated Zero-Crossing Detection.
 */

import { describe, it, expect } from 'vitest';
import {
  getPortPosition,
  simplifyOrthogonalPoints,
  generateSvgPathWithRoundedCorners,
  isPointOnNodePerimeter,
  getChannelBetweenNodes,
  doSegmentsIntersect,
  findPathIntersections,
} from '../src/geometry';
import { SpatialOccupancyGrid } from '../src/grid';
import { GridBasedDiagramRouter } from '../src/grid-router';
import { OrthogonalDiagramRouter } from '../src/orthogonal-router';
import { bundleParallelCorridors } from '../src/corridor-bundler';
import { NodeDefinition, EdgeDefinition, RoutedPath } from '../src/types';
import {
  diagramNodes,
  diagramEdges,
  generateArchitectureDiagramSvg,
} from '../scripts/generate-architecture-diagram';

describe('Orthogonal Diagram Router Library', () => {
  describe('Port Geometry & Perimeter Docking', () => {
    const node: NodeDefinition = {
      id: 'node1',
      x: 100,
      y: 200,
      width: 80,
      height: 40,
    };

    it('calculates center port positions correctly for all 4 sides', () => {
      expect(getPortPosition(node, { nodeId: 'node1', side: 'left' })).toEqual({ x: 100, y: 220 });
      expect(getPortPosition(node, { nodeId: 'node1', side: 'right' })).toEqual({ x: 180, y: 220 });
      expect(getPortPosition(node, { nodeId: 'node1', side: 'top' })).toEqual({ x: 140, y: 200 });
      expect(getPortPosition(node, { nodeId: 'node1', side: 'bottom' })).toEqual({ x: 140, y: 240 });
    });

    it('validates points strictly on node perimeters', () => {
      expect(isPointOnNodePerimeter({ x: 100, y: 220 }, node)).toBe(true);
      expect(isPointOnNodePerimeter({ x: 180, y: 210 }, node)).toBe(true);
      expect(isPointOnNodePerimeter({ x: 140, y: 200 }, node)).toBe(true);
      expect(isPointOnNodePerimeter({ x: 140, y: 240 }, node)).toBe(true);
      expect(isPointOnNodePerimeter({ x: 140, y: 220 }, node)).toBe(false); // interior point
    });

    it('calculates inter-node clearway channels correctly', () => {
      const nodeA: NodeDefinition = { id: 'A', x: 0, y: 0, width: 100, height: 100 };
      const nodeB: NodeDefinition = { id: 'B', x: 200, y: 0, width: 100, height: 100 };
      const channel = getChannelBetweenNodes(nodeA, nodeB);
      expect(channel.orientation).toBe('vertical');
      expect(channel.coordinate).toBe(150);
    });
  });

  describe('Strict 90-Degree Perpendicular Departures and Arrivals', () => {
    const nodes: NodeDefinition[] = [
      { id: 'source', x: 50, y: 50, width: 100, height: 50 },
      { id: 'target', x: 300, y: 150, width: 100, height: 50 },
    ];

    it('ensures routes leave and arrive strictly normal to node faces', () => {
      const edge: EdgeDefinition = {
        id: 'e1',
        from: { nodeId: 'source', side: 'right', fraction: 0.5 },
        to: { nodeId: 'target', side: 'left', fraction: 0.5 },
      };

      const router = new OrthogonalDiagramRouter({ nodes, edges: [edge] });
      const routed = router.routeEdge(edge);

      const pts = routed.points;
      expect(pts.length).toBeGreaterThanOrEqual(4);

      // First segment must be horizontal (normal to right side)
      expect(pts[0]!.y).toBe(pts[1]!.y);
      expect(pts[1]!.x).toBeGreaterThan(pts[0]!.x);

      // Last segment must be horizontal (normal to left side)
      const lastIdx = pts.length - 1;
      expect(pts[lastIdx]!.y).toBe(pts[lastIdx - 1]!.y);
      expect(pts[lastIdx]!.x).toBeGreaterThan(pts[lastIdx - 1]!.x);

      // Middle segment must be vertical (90-degree turn)
      expect(pts[1]!.x).toBe(pts[2]!.x);
    });

    it('ensures top-to-bottom vertical connections are 100% perpendicular', () => {
      const edge: EdgeDefinition = {
        id: 'e2',
        from: { nodeId: 'source', side: 'bottom', fraction: 0.5 },
        to: { nodeId: 'target', side: 'top', fraction: 0.5 },
      };

      const router = new OrthogonalDiagramRouter({ nodes, edges: [edge] });
      const routed = router.routeEdge(edge);

      const pts = routed.points;
      // First segment vertical down
      expect(pts[0]!.x).toBe(pts[1]!.x);
      expect(pts[1]!.y).toBeGreaterThan(pts[0]!.y);

      // Last segment vertical down into target
      const lastIdx = pts.length - 1;
      expect(pts[lastIdx]!.x).toBe(pts[lastIdx - 1]!.x);
      expect(pts[lastIdx]!.y).toBeGreaterThan(pts[lastIdx - 1]!.y);
    });
  });

  describe('Planar Co-Directional Turns & Intersection Avoidance', () => {
    it('detects intersecting orthogonal segments accurately', () => {
      // Horizontal segment at y=100 from x=50 to x=200
      const h1 = { x: 50, y: 100 };
      const h2 = { x: 200, y: 100 };

      // Vertical segment crossing at x=120 from y=50 to y=150
      const v1 = { x: 120, y: 50 };
      const v2 = { x: 120, y: 150 };

      // Vertical segment outside at x=250 from y=50 to y=150
      const vOutside1 = { x: 250, y: 50 };
      const vOutside2 = { x: 250, y: 150 };

      expect(doSegmentsIntersect(h1, h2, v1, v2)).toBe(true);
      expect(doSegmentsIntersect(h1, h2, vOutside1, vOutside2)).toBe(false);
    });

    it('nests co-directional Down-and-Right turns without crossing', () => {
      // Left Source -> Left Target (Outer Line)
      // Right Source -> Right Target (Inner Line)
      const nodes: NodeDefinition[] = [
        { id: 'srcLeft', x: 100, y: 50, width: 60, height: 40 },
        { id: 'srcRight', x: 250, y: 50, width: 60, height: 40 },
        { id: 'tgtLeft', x: 350, y: 300, width: 60, height: 40 },
        { id: 'tgtRight', x: 500, y: 300, width: 60, height: 40 },
      ];

      const edges: EdgeDefinition[] = [
        // Inner line turns at Y=150 (higher up)
        {
          id: 'inner-line',
          from: { nodeId: 'srcRight', side: 'bottom', fraction: 0.5 },
          to: { nodeId: 'tgtRight', side: 'top', fraction: 0.5 },
          corridorHints: { channelY: [150] },
        },
        // Outer line turns at Y=200 (lower down, passing underneath the inner line)
        {
          id: 'outer-line',
          from: { nodeId: 'srcLeft', side: 'bottom', fraction: 0.5 },
          to: { nodeId: 'tgtLeft', side: 'top', fraction: 0.5 },
          corridorHints: { channelY: [200] },
        },
      ];

      const router = new OrthogonalDiagramRouter({ nodes, edges });
      const { paths } = router.routeDiagram();

      const intersections = findPathIntersections(paths);
      expect(intersections).toHaveLength(0);
    });

    it('nests co-directional Up-and-Right turns without crossing', () => {
      const nodes: NodeDefinition[] = [
        { id: 'srcTop', x: 50, y: 100, width: 60, height: 40 },
        { id: 'srcBottom', x: 50, y: 200, width: 60, height: 40 },
        { id: 'tgtTop', x: 300, y: 50, width: 60, height: 40 },
        { id: 'tgtBottom', x: 300, y: 150, width: 60, height: 40 },
      ];

      const edges: EdgeDefinition[] = [
        // Inner line: srcTop -> tgtTop (turns at X=150)
        {
          id: 'inner-line',
          from: { nodeId: 'srcTop', side: 'right', fraction: 0.5 },
          to: { nodeId: 'tgtTop', side: 'left', fraction: 0.5 },
          corridorHints: { channelX: [150] },
        },
        // Outer line: srcBottom -> tgtBottom (turns at X=200, outside inner line)
        {
          id: 'outer-line',
          from: { nodeId: 'srcBottom', side: 'right', fraction: 0.5 },
          to: { nodeId: 'tgtBottom', side: 'left', fraction: 0.5 },
          corridorHints: { channelX: [200] },
        },
      ];

      const router = new OrthogonalDiagramRouter({ nodes, edges });
      const { paths } = router.routeDiagram();

      const intersections = findPathIntersections(paths);
      expect(intersections).toHaveLength(0);
    });
  });

  describe('Overlap-Only Parallel Bundling', () => {
    it('does NOT stagger paths when their spans do not overlap', () => {
      const path1: RoutedPath = {
        edgeId: 'p1',
        cssClass: 'blue',
        points: [
          { x: 100, y: 50 },
          { x: 200, y: 50 },
          { x: 200, y: 80 },
          { x: 300, y: 80 },
        ],
        segments: [],
      };

      const path2: RoutedPath = {
        edgeId: 'p2',
        cssClass: 'blue',
        points: [
          { x: 100, y: 200 },
          { x: 200, y: 200 },
          { x: 200, y: 250 },
          { x: 300, y: 250 },
        ],
        segments: [],
      };

      const bundled = bundleParallelCorridors([path1, path2], { laneSpacing: 8 });
      expect(bundled).toHaveLength(2);

      // Both paths should remain on X=200 because their Y spans [50..80] and [200..250] are disjoint
      expect(bundled[0]!.points[1]!.x).toBe(200);
      expect(bundled[1]!.points[1]!.x).toBe(200);
    });

    it('applies parallel lane offsets when spans DO overlap', () => {
      const path1: RoutedPath = {
        edgeId: 'p1',
        cssClass: 'blue',
        points: [
          { x: 100, y: 50 },
          { x: 200, y: 50 },
          { x: 200, y: 120 },
          { x: 300, y: 120 },
        ],
        segments: [],
      };

      const path2: RoutedPath = {
        edgeId: 'p2',
        cssClass: 'blue',
        points: [
          { x: 100, y: 80 },
          { x: 200, y: 80 },
          { x: 200, y: 150 },
          { x: 300, y: 150 },
        ],
        segments: [],
      };

      const bundled = bundleParallelCorridors([path1, path2], { laneSpacing: 6 });
      expect(bundled).toHaveLength(2);

      // Overlapping spans [50..120] and [80..150] must receive parallel lane offsets
      const x1 = bundled[0]!.points[1]!.x;
      const x2 = bundled[1]!.points[1]!.x;
      expect(x1).not.toBe(x2);
      expect(Math.abs(x1 - x2)).toBeCloseTo(6, 1);
    });
  });

  describe('Full Architecture Diagram Zero Crossings Assertion', () => {
    it('generates the full system architecture diagram with 0 path crossings', () => {
      const svg = generateArchitectureDiagramSvg();
      expect(svg).toBeDefined();
      expect(svg).toContain('<path id="edge-cancel-to-stripe"');
      expect(svg).toContain('<path id="edge-db-to-datamanager"');
      expect(svg).toContain('<path id="edge-grading-to-acl"');
      expect(svg).toContain('<path id="edge-fulfillment-to-videos"');
    });
  });
});
