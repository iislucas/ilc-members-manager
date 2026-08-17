/* docs/minitools/diagram-router/src/corridor-bundler.ts
 *
 * Multi-track corridor bundling and parallel lane offset assignment.
 * When multiple paths share the same route/corridor, this module draws them
 * neatly side-by-side with calculated lane offsets ONLY when their spans overlap
 * (preventing physical collisions while avoiding unnecessary staggering when disjoint).
 */

import { Point, RoutedPath } from './types';
import { simplifyOrthogonalPoints } from './geometry';

export interface BundlingOptions {
  laneSpacing?: number; // Distance in pixels between parallel tracks (default: 6)
  clusterTolerance?: number; // Tolerance to group collinear corridors (default: 8)
}

interface CorridorSegmentMember {
  pathIndex: number;
  segmentIndex: number;
  startCoord: number;
  endCoord: number;
  originalSegment: { p1: Point; p2: Point };
}

interface CorridorCluster {
  orientation: 'vertical' | 'horizontal';
  baseCoordinate: number;
  members: CorridorSegmentMember[];
}

/**
 * Checks if two 1D intervals [a1, b1] and [a2, b2] overlap.
 */
function doIntervalsOverlap(a1: number, b1: number, a2: number, b2: number, minOverlap = 2): boolean {
  return Math.min(b1, b2) - Math.max(a1, a2) > minOverlap;
}

/**
 * Partitions a set of corridor members into mutually overlapping sub-groups.
 * Members in different sub-groups do NOT touch or overlap and can therefore
 * remain on the centerline without unnecessary staggering.
 */
function partitionIntoOverlapGroups(members: CorridorSegmentMember[]): CorridorSegmentMember[][] {
  if (members.length <= 1) return [members];

  // Build adjacency graph of overlapping members
  const n = members.length;
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m1 = members[i]!;
      const m2 = members[j]!;
      if (doIntervalsOverlap(m1.startCoord, m1.endCoord, m2.startCoord, m2.endCoord)) {
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }

  // Find connected components
  const visited = new Set<number>();
  const groups: CorridorSegmentMember[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const group: CorridorSegmentMember[] = [];
    const queue = [i];
    visited.add(i);

    while (queue.length > 0) {
      const u = queue.shift()!;
      group.push(members[u]!);
      for (const v of adj[u]!) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }
    groups.push(group);
  }

  return groups;
}

/**
 * Detects overlapping/collinear corridors across all routed paths and applies
 * symmetric multi-lane offsets so paths running along the same corridor
 * are rendered parallel to each other.
 */
export function bundleParallelCorridors(
  paths: RoutedPath[],
  options: BundlingOptions = {},
): RoutedPath[] {
  const laneSpacing = options.laneSpacing ?? 6;
  const clusterTolerance = options.clusterTolerance ?? 8;

  // Deep clone paths so we don't mutate input
  const resultPaths: RoutedPath[] = paths.map((p) => ({
    ...p,
    points: p.points.map((pt) => ({ ...pt })),
  }));

  const vClusters: CorridorCluster[] = [];
  const hClusters: CorridorCluster[] = [];

  for (let pIdx = 0; pIdx < resultPaths.length; pIdx++) {
    const pts = resultPaths[pIdx]!.points;
    for (let sIdx = 0; sIdx < pts.length - 1; sIdx++) {
      const p1 = pts[sIdx]!;
      const p2 = pts[sIdx + 1]!;

      const isVertical = Math.abs(p1.x - p2.x) < 1e-4;
      const isHorizontal = Math.abs(p1.y - p2.y) < 1e-4;

      if (isVertical && Math.abs(p1.y - p2.y) > 5) {
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);

        let cluster = vClusters.find(
          (c) => Math.abs(c.baseCoordinate - p1.x) <= clusterTolerance,
        );
        if (!cluster) {
          cluster = {
            orientation: 'vertical',
            baseCoordinate: p1.x,
            members: [],
          };
          vClusters.push(cluster);
        }

        cluster.members.push({
          pathIndex: pIdx,
          segmentIndex: sIdx,
          startCoord: minY,
          endCoord: maxY,
          originalSegment: { p1, p2 },
        });
      } else if (isHorizontal && Math.abs(p1.x - p2.x) > 5) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);

        let cluster = hClusters.find(
          (c) => Math.abs(c.baseCoordinate - p1.y) <= clusterTolerance,
        );
        if (!cluster) {
          cluster = {
            orientation: 'horizontal',
            baseCoordinate: p1.y,
            members: [],
          };
          hClusters.push(cluster);
        }

        cluster.members.push({
          pathIndex: pIdx,
          segmentIndex: sIdx,
          startCoord: minX,
          endCoord: maxX,
          originalSegment: { p1, p2 },
        });
      }
    }
  }

  // Process vertical corridor clusters (with overlap-only sub-grouping)
  for (const cluster of vClusters) {
    const overlapGroups = partitionIntoOverlapGroups(cluster.members);

    for (const group of overlapGroups) {
      if (group.length <= 1) continue; // Single line in this interval -> stay exactly on centerline!

      // Sort by source start Y then destination end Y for planar crossing prevention
      group.sort((a, b) => {
        const pathA = resultPaths[a.pathIndex]!;
        const pathB = resultPaths[b.pathIndex]!;
        const startYA = pathA.points[0]?.y ?? a.startCoord;
        const startYB = pathB.points[0]?.y ?? b.startCoord;
        if (startYA !== startYB) return startYA - startYB;
        const endYA = pathA.points[pathA.points.length - 1]?.y ?? a.endCoord;
        const endYB = pathB.points[pathB.points.length - 1]?.y ?? b.endCoord;
        return endYA - endYB;
      });

      const k = group.length;
      for (let i = 0; i < k; i++) {
        const member = group[i]!;
        const offset = (i - (k - 1) / 2) * laneSpacing;
        const newX = cluster.baseCoordinate + offset;

        const path = resultPaths[member.pathIndex]!;
        const pt1 = path.points[member.segmentIndex]!;
        const pt2 = path.points[member.segmentIndex + 1]!;

        pt1.x = newX;
        pt2.x = newX;
      }
    }
  }

  // Process horizontal corridor clusters (with overlap-only sub-grouping)
  for (const cluster of hClusters) {
    const overlapGroups = partitionIntoOverlapGroups(cluster.members);

    for (const group of overlapGroups) {
      if (group.length <= 1) continue; // Single line in this interval -> stay exactly on centerline!

      group.sort((a, b) => {
        const pathA = resultPaths[a.pathIndex]!;
        const pathB = resultPaths[b.pathIndex]!;
        const endXA = pathA.points[pathA.points.length - 1]?.x ?? a.endCoord;
        const endXB = pathB.points[pathB.points.length - 1]?.x ?? b.endCoord;
        if (endXA !== endXB) return endXA - endXB;
        const startXA = pathA.points[0]?.x ?? a.startCoord;
        const startXB = pathB.points[0]?.x ?? b.startCoord;
        return startXA - startXB;
      });

      const k = group.length;
      for (let i = 0; i < k; i++) {
        const member = group[i]!;
        const offset = (i - (k - 1) / 2) * laneSpacing;
        const newY = cluster.baseCoordinate + offset;

        const path = resultPaths[member.pathIndex]!;
        const pt1 = path.points[member.segmentIndex]!;
        const pt2 = path.points[member.segmentIndex + 1]!;

        pt1.y = newY;
        pt2.y = newY;
      }
    }
  }

  for (const p of resultPaths) {
    p.points = simplifyOrthogonalPoints(p.points);
  }

  return resultPaths;
}
