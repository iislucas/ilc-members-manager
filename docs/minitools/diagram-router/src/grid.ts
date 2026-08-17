/* docs/minitools/diagram-router/src/grid.ts
 *
 * Spatial Occupancy Grid for schematic diagram routing.
 * Divides the canvas into a uniform discrete grid of cells and tracks
 * occupied obstacle areas, port clearance zones, and dynamic route congestion.
 */

import { Point, Rect } from './types';

export class SpatialOccupancyGrid {
  public readonly width: number;
  public readonly height: number;
  public readonly cellSize: number;
  public readonly cols: number;
  public readonly rows: number;

  // 0 = free, 1 = static obstacle (node), 2+ = congestion/route occupancy
  private cells: Int32Array;

  constructor(width: number, height: number, cellSize = 6) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = new Int32Array(this.cols * this.rows);
  }

  public toGridX(canvasX: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.round(canvasX / this.cellSize)));
  }

  public toGridY(canvasY: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.round(canvasY / this.cellSize)));
  }

  public toCanvasX(gridX: number): number {
    return gridX * this.cellSize;
  }

  public toCanvasY(gridY: number): number {
    return gridY * this.cellSize;
  }

  public getIndex(gx: number, gy: number): number {
    return gy * this.cols + gx;
  }

  public isValid(gx: number, gy: number): boolean {
    return gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows;
  }

  public isObstacle(gx: number, gy: number): boolean {
    if (!this.isValid(gx, gy)) return true;
    return (this.cells[this.getIndex(gx, gy)]! & 1) === 1;
  }

  public getCost(gx: number, gy: number): number {
    if (!this.isValid(gx, gy)) return Infinity;
    const val = this.cells[this.getIndex(gx, gy)]!;
    if ((val & 1) === 1) return Infinity;
    // Congestion cost based on existing routes sharing this cell
    const routeCount = val >> 1;
    return 1 + routeCount * 8;
  }

  public markObstacleRect(rect: Rect, margin = 2): void {
    const rx1 = rect.x - margin;
    const rx2 = rect.x + rect.width + margin;
    const ry1 = rect.y - margin;
    const ry2 = rect.y + rect.height + margin;

    const minGx = Math.max(0, Math.floor(rx1 / this.cellSize));
    const maxGx = Math.min(this.cols - 1, Math.floor(rx2 / this.cellSize));
    const minGy = Math.max(0, Math.floor(ry1 / this.cellSize));
    const maxGy = Math.min(this.rows - 1, Math.floor(ry2 / this.cellSize));

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const cellLeft = gx * this.cellSize;
        const cellRight = (gx + 1) * this.cellSize;
        const cellTop = gy * this.cellSize;
        const cellBottom = (gy + 1) * this.cellSize;

        if (cellRight > rx1 && cellLeft < rx2 && cellBottom > ry1 && cellTop < ry2) {
          this.cells[this.getIndex(gx, gy)]! |= 1;
        }
      }
    }
  }

  public clearCellObstacle(gx: number, gy: number): void {
    if (this.isValid(gx, gy)) {
      this.cells[this.getIndex(gx, gy)]! &= ~1;
    }
  }

  public addRouteOccupancy(points: Point[]): void {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;

      const gx1 = this.toGridX(p1.x);
      const gy1 = this.toGridY(p1.y);
      const gx2 = this.toGridX(p2.x);
      const gy2 = this.toGridY(p2.y);

      const minGx = Math.min(gx1, gx2);
      const maxGx = Math.max(gx1, gx2);
      const minGy = Math.min(gy1, gy2);
      const maxGy = Math.max(gy1, gy2);

      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          if (this.isValid(gx, gy)) {
            // Increment route count (stored in bits 1+)
            const current = this.cells[this.getIndex(gx, gy)]!;
            this.cells[this.getIndex(gx, gy)] = current + 2;
          }
        }
      }
    }
  }
}
