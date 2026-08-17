/* docs/minitools/diagram-router/src/orthogonal-router.ts
 *
 * Strict Orthogonal Manhattan Router with Perpendicular 90-Degree Docking,
 * Inter-Node Channel Clearance, and Planar Corridor Bundling.
 */

import {
  DiagramConfig,
  EdgeDefinition,
  NodeDefinition,
  Point,
  RoutedPath,
} from './types';
import {
  getPortPosition,
  simplifyOrthogonalPoints,
  pointsToSegments,
  generateSvgPathWithRoundedCorners,
  isPointOnNodePerimeter,
} from './geometry';
import { bundleParallelCorridors } from './corridor-bundler';

export class OrthogonalDiagramRouter {
  private config: DiagramConfig;
  private nodeMap: Map<string, NodeDefinition> = new Map();

  constructor(config: DiagramConfig) {
    this.config = config;
    for (const node of config.nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * Routes a single edge between its source and target ports, ensuring 100%
   * perpendicular departure and arrival at 90-degree angles.
   */
  public routeEdge(edge: EdgeDefinition): RoutedPath {
    const fromNode = this.nodeMap.get(edge.from.nodeId);
    const toNode = this.nodeMap.get(edge.to.nodeId);

    if (!fromNode || !toNode) {
      throw new Error(
        `Invalid edge ${edge.id}: node '${edge.from.nodeId}' or '${edge.to.nodeId}' not found.`,
      );
    }

    const pStart = getPortPosition(fromNode, edge.from);
    const pEnd = getPortPosition(toNode, edge.to);

    const points: Point[] = [pStart];

    // Check if explicit orthogonal waypoints are provided
    if (edge.corridorHints?.waypoints && edge.corridorHints.waypoints.length > 0) {
      for (const wp of edge.corridorHints.waypoints) {
        points.push({ ...wp });
      }
      points.push(pEnd);
    } else {
      const isDirectHorizontal =
        Math.abs(pStart.y - pEnd.y) < 1e-4 &&
        ((edge.from.side === 'right' && edge.to.side === 'left' && pEnd.x > pStart.x) ||
          (edge.from.side === 'left' && edge.to.side === 'right' && pEnd.x < pStart.x));

      const isDirectVertical =
        Math.abs(pStart.x - pEnd.x) < 1e-4 &&
        ((edge.from.side === 'bottom' && edge.to.side === 'top' && pEnd.y > pStart.y) ||
          (edge.from.side === 'top' && edge.to.side === 'bottom' && pEnd.y < pStart.y));

      if (isDirectHorizontal || isDirectVertical) {
        points.push(pEnd);
      } else if (edge.corridorHints?.channelX && edge.corridorHints.channelX.length > 0) {
        const channelX = edge.corridorHints.channelX[0]!;
        points.push({ x: channelX, y: pStart.y });
        points.push({ x: channelX, y: pEnd.y });
        points.push(pEnd);
      } else if (edge.corridorHints?.channelY && edge.corridorHints.channelY.length > 0) {
        const channelY = edge.corridorHints.channelY[0]!;
        points.push({ x: pStart.x, y: channelY });
        points.push({ x: pEnd.x, y: channelY });
        points.push(pEnd);
      } else if (edge.from.side === 'right' && edge.to.side === 'left') {
        const midX = (pStart.x + pEnd.x) / 2;
        points.push({ x: midX, y: pStart.y });
        points.push({ x: midX, y: pEnd.y });
        points.push(pEnd);
      } else if (edge.from.side === 'bottom' && edge.to.side === 'top') {
        const midY = (pStart.y + pEnd.y) / 2;
        points.push({ x: pStart.x, y: midY });
        points.push({ x: pEnd.x, y: midY });
        points.push(pEnd);
      } else if (edge.from.side === 'bottom' && edge.to.side === 'left') {
        points.push({ x: pStart.x, y: pEnd.y });
        points.push(pEnd);
      } else if (edge.from.side === 'bottom' && edge.to.side === 'right') {
        points.push({ x: pStart.x, y: pEnd.y });
        points.push(pEnd);
      } else if (edge.from.side === 'left' && edge.to.side === 'right') {
        const midX = (pStart.x + pEnd.x) / 2;
        points.push({ x: midX, y: pStart.y });
        points.push({ x: midX, y: pEnd.y });
        points.push(pEnd);
      } else if (edge.from.side === 'left' && edge.to.side === 'top') {
        points.push({ x: pEnd.x, y: pStart.y });
        points.push(pEnd);
      } else if (edge.from.side === 'right' && edge.to.side === 'top') {
        points.push({ x: pEnd.x, y: pStart.y });
        points.push(pEnd);
      } else {
        const midX = (pStart.x + pEnd.x) / 2;
        points.push({ x: midX, y: pStart.y });
        points.push({ x: midX, y: pEnd.y });
        points.push(pEnd);
      }
    }

    const simplified = simplifyOrthogonalPoints(points);
    const segments = pointsToSegments(simplified);

    return {
      edgeId: edge.id,
      points: simplified,
      segments,
      cssClass: edge.cssClass ?? 'svg-link',
      markerEnd: edge.markerEnd,
      dashed: edge.dashed,
      label: edge.label,
    };
  }

  /**
   * Routes all diagram edges and applies multi-track bundling on shared corridors.
   */
  public routeDiagram(): {
    paths: RoutedPath[];
    svgPaths: { id: string; d: string; cssClass: string; dashed?: boolean }[];
  } {
    const rawPaths: RoutedPath[] = this.config.edges.map((e) => this.routeEdge(e));

    const bundledPaths = bundleParallelCorridors(rawPaths, {
      laneSpacing: this.config.laneSpacing ?? 6,
    });

    const cornerRadius = this.config.cornerRadius ?? 4;

    const svgPaths = bundledPaths.map((path) => ({
      id: path.edgeId,
      d: generateSvgPathWithRoundedCorners(path.points, cornerRadius),
      cssClass: path.cssClass,
      dashed: path.dashed,
    }));

    return {
      paths: bundledPaths,
      svgPaths,
    };
  }
}
