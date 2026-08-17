/* docs/minitools/diagram-router/src/types.ts
 *
 * Data contracts and type definitions for programmatic orthogonal schematic routing.
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeDefinition extends Rect {
  id: string;
  label?: string;
  tier?: string;
}

export interface PortSpec {
  nodeId: string;
  side: Side;
  fraction?: number;
  offsetPixels?: number;
}

export interface EdgeDefinition {
  id: string;
  from: PortSpec;
  to: PortSpec;
  cssClass?: string;
  markerEnd?: string;
  dashed?: boolean;
  label?: string;
  /**
   * Explicit channel coordinates or waypoints if required for obstacle avoidance.
   */
  corridorHints?: {
    channelX?: number[];
    channelY?: number[];
    waypoints?: Point[];
  };
}

export interface Segment {
  start: Point;
  end: Point;
  orientation: 'horizontal' | 'vertical';
}

export interface RoutedPath {
  edgeId: string;
  points: Point[];
  segments: Segment[];
  cssClass: string;
  markerEnd?: string;
  dashed?: boolean;
  label?: string;
}

export interface DiagramConfig {
  nodes: NodeDefinition[];
  edges: EdgeDefinition[];
  laneSpacing?: number;
  cornerRadius?: number;
  nodeMargin?: number;
}
