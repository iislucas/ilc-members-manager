/* docs/minitools/diagram-router/src/grid-router.ts
 *
 * Optimal Orthogonal Grid Router based on Spatial Cell Occupancy and A* Search.
 * Routes paths through unoccupied grid cells, penalizes bends to ensure clean Manhattan lines,
 * and dynamically avoids congestion so overlapping paths stagger only when they would touch.
 */

import { Point, Rect, EdgeDefinition, NodeDefinition, RoutedPath } from './types';
import { SpatialOccupancyGrid } from './grid';
import { getPortPosition, simplifyOrthogonalPoints, pointsToSegments, generateSvgPathWithRoundedCorners } from './geometry';

type Direction = 'none' | 'left' | 'right' | 'up' | 'down';

interface AStarNode {
  gx: number;
  gy: number;
  dir: Direction;
  g: number;
  f: number;
  parent: AStarNode | null;
}

class MinHeap<T> {
  private data: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}

  public get size(): number {
    return this.data.length;
  }

  public push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  public pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const bottom = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (this.compare(this.data[idx]!, this.data[parentIdx]!) < 0) {
        const tmp = this.data[idx]!;
        this.data[idx] = this.data[parentIdx]!;
        this.data[parentIdx] = tmp;
        idx = parentIdx;
      } else {
        break;
      }
    }
  }

  private bubbleDown(idx: number): void {
    const len = this.data.length;
    while (true) {
      const leftIdx = (idx << 1) + 1;
      const rightIdx = leftIdx + 1;
      let smallest = idx;

      if (leftIdx < len && this.compare(this.data[leftIdx]!, this.data[smallest]!) < 0) {
        smallest = leftIdx;
      }
      if (rightIdx < len && this.compare(this.data[rightIdx]!, this.data[smallest]!) < 0) {
        smallest = rightIdx;
      }
      if (smallest !== idx) {
        const tmp = this.data[idx]!;
        this.data[idx] = this.data[smallest]!;
        this.data[smallest] = tmp;
        idx = smallest;
      } else {
        break;
      }
    }
  }
}

export interface GridRouterOptions {
  canvasWidth?: number;
  canvasHeight?: number;
  cellSize?: number;
  nodeMargin?: number;
  turnPenalty?: number;
  cornerRadius?: number;
}

export class GridBasedDiagramRouter {
  private grid: SpatialOccupancyGrid;
  private nodeMap: Map<string, NodeDefinition> = new Map();
  private turnPenalty: number;
  private cornerRadius: number;

  constructor(
    private nodes: NodeDefinition[],
    private edges: EdgeDefinition[],
    options: GridRouterOptions = {},
  ) {
    const width = options.canvasWidth ?? 960;
    const height = options.canvasHeight ?? 570;
    const cellSize = options.cellSize ?? 6;
    const margin = options.nodeMargin ?? 2;
    this.turnPenalty = options.turnPenalty ?? 18;
    this.cornerRadius = options.cornerRadius ?? 4;

    this.grid = new SpatialOccupancyGrid(width, height, cellSize);

    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
      this.grid.markObstacleRect(node, margin);
    }
  }

  /**
   * Finds the optimal orthogonal path for an edge using A* through un-occupied grid cells.
   */
  public routeEdge(edge: EdgeDefinition): RoutedPath {
    const fromNode = this.nodeMap.get(edge.from.nodeId);
    const toNode = this.nodeMap.get(edge.to.nodeId);

    if (!fromNode || !toNode) {
      throw new Error(`Edge ${edge.id} references unknown node: ${edge.from.nodeId} -> ${edge.to.nodeId}`);
    }

    const startPoint = getPortPosition(fromNode, edge.from);
    const endPoint = getPortPosition(toNode, edge.to);

    const startGx = this.grid.toGridX(startPoint.x);
    const startGy = this.grid.toGridY(startPoint.y);
    const endGx = this.grid.toGridX(endPoint.x);
    const endGy = this.grid.toGridY(endPoint.y);

    // If explicit orthogonal waypoints are provided in edge hints, use them directly
    if (edge.corridorHints?.waypoints && edge.corridorHints.waypoints.length > 0) {
      const explicitPoints = [startPoint, ...edge.corridorHints.waypoints, endPoint];
      const simplified = simplifyOrthogonalPoints(explicitPoints);
      this.grid.addRouteOccupancy(simplified);
      return {
        edgeId: edge.id,
        points: simplified,
        segments: pointsToSegments(simplified),
        cssClass: edge.cssClass ?? 'svg-link',
        markerEnd: edge.markerEnd,
        dashed: edge.dashed,
        label: edge.label,
      };
    }

    // Direct straight line check for perfectly aligned ports with clear line-of-sight
    let isDirectVertical =
      Math.abs(startPoint.x - endPoint.x) < 2 &&
      ((edge.from.side === 'top' && edge.to.side === 'bottom' && startPoint.y > endPoint.y) ||
        (edge.from.side === 'bottom' && edge.to.side === 'top' && startPoint.y < endPoint.y));

    let isDirectHorizontal =
      Math.abs(startPoint.y - endPoint.y) < 2 &&
      ((edge.from.side === 'right' && edge.to.side === 'left' && startPoint.x < endPoint.x) ||
        (edge.from.side === 'left' && edge.to.side === 'right' && startPoint.x > endPoint.x));

    if (isDirectHorizontal) {
      const minGx = Math.min(startGx, endGx);
      const maxGx = Math.max(startGx, endGx);
      for (let gx = minGx + 2; gx <= maxGx - 2; gx++) {
        if (this.grid.isObstacle(gx, startGy)) {
          isDirectHorizontal = false;
          break;
        }
      }
    }

    if (isDirectVertical) {
      const minGy = Math.min(startGy, endGy);
      const maxGy = Math.max(startGy, endGy);
      for (let gy = minGy + 2; gy <= maxGy - 2; gy++) {
        if (this.grid.isObstacle(startGx, gy)) {
          isDirectVertical = false;
          break;
        }
      }
    }

    if (isDirectVertical || isDirectHorizontal) {
      const directPoints = [startPoint, endPoint];
      this.grid.addRouteOccupancy(directPoints);
      return {
        edgeId: edge.id,
        points: directPoints,
        segments: pointsToSegments(directPoints),
        cssClass: edge.cssClass ?? 'svg-link',
        markerEnd: edge.markerEnd,
        dashed: edge.dashed,
        label: edge.label,
      };
    }

    // Temporarily clear obstacle bits at start/end port cells and their immediate approach cells
    this.grid.clearCellObstacle(startGx, startGy);
    this.grid.clearCellObstacle(endGx, endGy);

    if (edge.from.side === 'right') this.grid.clearCellObstacle(startGx + 1, startGy);
    if (edge.from.side === 'left') this.grid.clearCellObstacle(startGx - 1, startGy);
    if (edge.from.side === 'top') this.grid.clearCellObstacle(startGx, startGy - 1);
    if (edge.from.side === 'bottom') this.grid.clearCellObstacle(startGx, startGy + 1);

    if (edge.to.side === 'left') this.grid.clearCellObstacle(endGx - 1, endGy);
    if (edge.to.side === 'right') this.grid.clearCellObstacle(endGx + 1, endGy);
    if (edge.to.side === 'top') this.grid.clearCellObstacle(endGx, endGy - 1);
    if (edge.to.side === 'bottom') this.grid.clearCellObstacle(endGx, endGy + 1);

    // Initial direction based on source port side
    let initialDir: Direction = 'none';
    if (edge.from.side === 'right') initialDir = 'right';
    else if (edge.from.side === 'left') initialDir = 'left';
    else if (edge.from.side === 'top') initialDir = 'up';
    else if (edge.from.side === 'bottom') initialDir = 'down';

    // Priority Queue for A* search (open set)
    const openSet = new MinHeap<AStarNode>((a, b) => a.f - b.f);
    const closedSet = new Map<string, number>();

    const startNode: AStarNode = {
      gx: startGx,
      gy: startGy,
      dir: initialDir,
      g: 0,
      f: Math.abs(startGx - endGx) + Math.abs(startGy - endGy),
      parent: null,
    };

    openSet.push(startNode);

    let goalNode: AStarNode | null = null;

    const moves: { dx: number; dy: number; dir: Direction }[] = [
      { dx: 1, dy: 0, dir: 'right' },
      { dx: -1, dy: 0, dir: 'left' },
      { dx: 0, dy: 1, dir: 'down' },
      { dx: 0, dy: -1, dir: 'up' },
    ];

    while (openSet.size > 0) {
      const current = openSet.pop()!;

      if (current.gx === endGx && current.gy === endGy) {
        goalNode = current;
        break;
      }

      const stateKey = `${current.gx},${current.gy},${current.dir}`;
      const bestG = closedSet.get(stateKey);
      if (bestG !== undefined && bestG <= current.g) {
        continue;
      }
      closedSet.set(stateKey, current.g);

      for (const move of moves) {
        // Prevent immediate 180-degree backtracking
        if (
          (current.dir === 'right' && move.dir === 'left') ||
          (current.dir === 'left' && move.dir === 'right') ||
          (current.dir === 'up' && move.dir === 'down') ||
          (current.dir === 'down' && move.dir === 'up')
        ) {
          continue;
        }

        const nextGx = current.gx + move.dx;
        const nextGy = current.gy + move.dy;

        if (!this.grid.isValid(nextGx, nextGy)) continue;

        const cellCost = this.grid.getCost(nextGx, nextGy);
        if (!isFinite(cellCost)) continue;

        const isTurn = current.dir !== 'none' && current.dir !== move.dir;
        const turnCost = isTurn ? this.turnPenalty : 0;

        const nextG = current.g + cellCost + turnCost;
        const h = Math.abs(nextGx - endGx) + Math.abs(nextGy - endGy);
        const nextF = nextG + h;

        const nextNode: AStarNode = {
          gx: nextGx,
          gy: nextGy,
          dir: move.dir,
          g: nextG,
          f: nextF,
          parent: current,
        };

        openSet.push(nextNode);
      }
    }

    const rawPoints: Point[] = [];
    if (goalNode) {
      let curr: AStarNode | null = goalNode;
      while (curr) {
        rawPoints.push({
          x: this.grid.toCanvasX(curr.gx),
          y: this.grid.toCanvasY(curr.gy),
        });
        curr = curr.parent;
      }
      rawPoints.reverse();
    } else {
      // Fallback: direct Manhattan clearway
      rawPoints.push({ x: startPoint.x, y: startPoint.y });
      const midX = (startPoint.x + endPoint.x) / 2;
      rawPoints.push({ x: midX, y: startPoint.y });
      rawPoints.push({ x: midX, y: endPoint.y });
      rawPoints.push({ x: endPoint.x, y: endPoint.y });
    }

    // Anchor strictly to the exact continuous port positions on node perimeter
    if (rawPoints.length > 0) {
      rawPoints[0] = { x: startPoint.x, y: startPoint.y };
      rawPoints[rawPoints.length - 1] = { x: endPoint.x, y: endPoint.y };
    }

    const simplified = simplifyOrthogonalPoints(rawPoints);
    this.grid.addRouteOccupancy(simplified);

    return {
      edgeId: edge.id,
      points: simplified,
      segments: pointsToSegments(simplified),
      cssClass: edge.cssClass ?? 'svg-link',
      markerEnd: edge.markerEnd,
      dashed: edge.dashed,
      label: edge.label,
    };
  }

  /**
   * Routes all diagram edges using un-occupied space grid search.
   */
  public routeDiagram(): {
    paths: RoutedPath[];
    svgPaths: { id: string; d: string; cssClass: string; dashed?: boolean }[];
  } {
    const paths: RoutedPath[] = [];

    for (const edge of this.edges) {
      const routed = this.routeEdge(edge);
      paths.push(routed);
    }

    const svgPaths = paths.map((path) => ({
      id: path.edgeId,
      d: generateSvgPathWithRoundedCorners(path.points, this.cornerRadius),
      cssClass: path.cssClass,
      dashed: path.dashed,
    }));

    return { paths, svgPaths };
  }
}
