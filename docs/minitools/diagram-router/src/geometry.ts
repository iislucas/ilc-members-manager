/* docs/minitools/diagram-router/src/geometry.ts
 *
 * Geometric utilities for calculating port anchor points,
 * box clearances, channel intersections, and SVG rounded corner generation.
 */

import { Point, Rect, PortSpec, NodeDefinition, Segment } from './types';

/**
 * Calculates absolute (x, y) coordinates for a port on a node boundary.
 */
export function getPortPosition(node: NodeDefinition, port: PortSpec): Point {
  const fraction = port.fraction ?? 0.5;
  const offset = port.offsetPixels ?? 0;

  switch (port.side) {
    case 'left':
      return {
        x: node.x,
        y: node.y + node.height * fraction + offset,
      };
    case 'right':
      return {
        x: node.x + node.width,
        y: node.y + node.height * fraction + offset,
      };
    case 'top':
      return {
        x: node.x + node.width * fraction + offset,
        y: node.y,
      };
    case 'bottom':
      return {
        x: node.x + node.width * fraction + offset,
        y: node.y + node.height,
      };
  }
}

/**
 * Validates whether a point lies on the exact boundary perimeter of a node.
 */
export function isPointOnNodePerimeter(
  p: Point,
  node: NodeDefinition,
  tolerance = 1.0,
): boolean {
  const onLeftOrRight =
    (Math.abs(p.x - node.x) <= tolerance || Math.abs(p.x - (node.x + node.width)) <= tolerance) &&
    p.y >= node.y - tolerance &&
    p.y <= node.y + node.height + tolerance;

  const onTopOrBottom =
    (Math.abs(p.y - node.y) <= tolerance || Math.abs(p.y - (node.y + node.height)) <= tolerance) &&
    p.x >= node.x - tolerance &&
    p.x <= node.x + node.width + tolerance;

  return onLeftOrRight || onTopOrBottom;
}

/**
 * Calculates the clearway channel midpoint between two adjacent node bounding boxes.
 */
export function getChannelBetweenNodes(
  nodeA: NodeDefinition,
  nodeB: NodeDefinition,
): { orientation: 'horizontal' | 'vertical'; coordinate: number } {
  // If separated horizontally
  if (nodeA.x + nodeA.width < nodeB.x) {
    return {
      orientation: 'vertical',
      coordinate: (nodeA.x + nodeA.width + nodeB.x) / 2,
    };
  }
  if (nodeB.x + nodeB.width < nodeA.x) {
    return {
      orientation: 'vertical',
      coordinate: (nodeB.x + nodeB.width + nodeA.x) / 2,
    };
  }

  // If separated vertically
  if (nodeA.y + nodeA.height < nodeB.y) {
    return {
      orientation: 'horizontal',
      coordinate: (nodeA.y + nodeA.height + nodeB.y) / 2,
    };
  }
  return {
    orientation: 'horizontal',
    coordinate: (nodeB.y + nodeB.height + nodeA.y) / 2,
  };
}

/**
 * Checks if a point lies strictly inside a rectangle (with optional margin).
 */
export function isPointInsideRect(p: Point, r: Rect, margin = 0): boolean {
  return (
    p.x > r.x - margin &&
    p.x < r.x + r.width + margin &&
    p.y > r.y - margin &&
    p.y < r.y + r.height + margin
  );
}

/**
 * Checks if a line segment intersects a rectangle interior (with margin).
 */
export function doesSegmentIntersectRect(
  p1: Point,
  p2: Point,
  rect: Rect,
  margin = 2,
): boolean {
  const rx1 = rect.x - margin;
  const rx2 = rect.x + rect.width + margin;
  const ry1 = rect.y - margin;
  const ry2 = rect.y + rect.height + margin;

  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (Math.abs(p1.y - p2.y) < 1e-4) {
    const y = p1.y;
    if (y >= ry1 && y <= ry2) {
      return Math.max(minX, rx1) < Math.min(maxX, rx2);
    }
    return false;
  }

  if (Math.abs(p1.x - p2.x) < 1e-4) {
    const x = p1.x;
    if (x >= rx1 && x <= rx2) {
      return Math.max(minY, ry1) < Math.min(maxY, ry2);
    }
    return false;
  }

  return false;
}

/**
 * Checks if two orthogonal line segments strictly intersect (cross each other).
 */
export function doSegmentsIntersect(
  p1: Point,
  p2: Point,
  q1: Point,
  q2: Point,
): boolean {
  const isP1Horizontal = Math.abs(p1.y - p2.y) < 1e-4;
  const isP1Vertical = Math.abs(p1.x - p2.x) < 1e-4;
  const isQ1Horizontal = Math.abs(q1.y - q2.y) < 1e-4;
  const isQ1Vertical = Math.abs(q1.x - q2.x) < 1e-4;

  // Case 1: P is horizontal, Q is vertical
  if (isP1Horizontal && isQ1Vertical) {
    const y = p1.y;
    const x = q1.x;
    const minPx = Math.min(p1.x, p2.x);
    const maxPx = Math.max(p1.x, p2.x);
    const minQy = Math.min(q1.y, q2.y);
    const maxQy = Math.max(q1.y, q2.y);

    return x > minPx && x < maxPx && y > minQy && y < maxQy;
  }

  // Case 2: P is vertical, Q is horizontal
  if (isP1Vertical && isQ1Horizontal) {
    const x = p1.x;
    const y = q1.y;
    const minPy = Math.min(p1.y, p2.y);
    const maxPy = Math.max(p1.y, p2.y);
    const minQx = Math.min(q1.x, q2.x);
    const maxQx = Math.max(q1.x, q2.x);

    return x > minQx && x < maxQx && y > minPy && y < maxPy;
  }

  return false;
}

/**
 * Finds all strictly intersecting pairs of paths from a list of routed paths.
 */
export function findPathIntersections(
  paths: { edgeId: string; points: Point[] }[],
): { edge1: string; edge2: string }[] {
  const intersections: { edge1: string; edge2: string }[] = [];

  for (let i = 0; i < paths.length; i++) {
    const pts1 = paths[i]!.points;
    for (let j = i + 1; j < paths.length; j++) {
      const pts2 = paths[j]!.points;

      for (let s1 = 0; s1 < pts1.length - 1; s1++) {
        for (let s2 = 0; s2 < pts2.length - 1; s2++) {
          if (
            doSegmentsIntersect(
              pts1[s1]!,
              pts1[s1 + 1]!,
              pts2[s2]!,
              pts2[s2 + 1]!,
            )
          ) {
            intersections.push({
              edge1: paths[i]!.edgeId,
              edge2: paths[j]!.edgeId,
            });
          }
        }
      }
    }
  }

  return intersections;
}

/**
 * Simplifies a sequence of points by removing redundant collinear intermediate points.
 */
export function simplifyOrthogonalPoints(points: Point[], tolerance = 0.05): Point[] {
  if (points.length <= 2) return [...points];

  const result: Point[] = [points[0]!];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    const isCollinearX =
      Math.abs(prev.x - curr.x) <= tolerance && Math.abs(curr.x - next.x) <= tolerance;
    const isCollinearY =
      Math.abs(prev.y - curr.y) <= tolerance && Math.abs(curr.y - next.y) <= tolerance;

    if (isCollinearX || isCollinearY) {
      continue;
    }

    if (Math.abs(curr.x - prev.x) <= tolerance && Math.abs(curr.y - prev.y) <= tolerance) {
      continue;
    }

    result.push(curr);
  }

  const last = points[points.length - 1]!;
  const prevLast = result[result.length - 1]!;
  if (Math.abs(last.x - prevLast.x) > tolerance || Math.abs(last.y - prevLast.y) > tolerance) {
    result.push(last);
  }

  return result;
}

/**
 * Converts a sequence of orthogonal points into discrete horizontal / vertical segments.
 */
export function pointsToSegments(points: Point[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const isHorizontal = Math.abs(p1.y - p2.y) < 1e-4;
    segments.push({
      start: p1,
      end: p2,
      orientation: isHorizontal ? 'horizontal' : 'vertical',
    });
  }
  return segments;
}

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Math.abs(r - Math.round(r)) < 1e-4 ? Math.round(r).toString() : r.toFixed(1);
}

/**
 * Generates an SVG path `d` string with smooth rounded 90-degree corners.
 */
export function generateSvgPathWithRoundedCorners(points: Point[], radius = 5): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)} L ${fmt(points[1]!.x)} ${fmt(points[1]!.y)}`;
  }

  let d = `M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`;

  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1]!;
    const pCurr = points[i]!;
    const pNext = points[i + 1]!;

    const vIn = { x: pCurr.x - pPrev.x, y: pCurr.y - pPrev.y };
    const lenIn = Math.hypot(vIn.x, vIn.y);
    const vOut = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
    const lenOut = Math.hypot(vOut.x, vOut.y);

    const r = Math.min(radius, lenIn / 2, lenOut / 2);

    if (r <= 0.5) {
      d += ` L ${fmt(pCurr.x)} ${fmt(pCurr.y)}`;
      continue;
    }

    const uIn = { x: vIn.x / lenIn, y: vIn.y / lenIn };
    const uOut = { x: vOut.x / lenOut, y: vOut.y / lenOut };

    const pStartArc = {
      x: pCurr.x - uIn.x * r,
      y: pCurr.y - uIn.y * r,
    };
    const pEndArc = {
      x: pCurr.x + uOut.x * r,
      y: pCurr.y + uOut.y * r,
    };

    d += ` L ${fmt(pStartArc.x)} ${fmt(pStartArc.y)}`;
    d += ` Q ${fmt(pCurr.x)} ${fmt(pCurr.y)} ${fmt(pEndArc.x)} ${fmt(pEndArc.y)}`;
  }

  const pLast = points[points.length - 1]!;
  d += ` L ${fmt(pLast.x)} ${fmt(pLast.y)}`;

  return d;
}
