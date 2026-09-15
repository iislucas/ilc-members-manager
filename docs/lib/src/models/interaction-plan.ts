/* interaction-plan.ts
 *
 * Directed node-edge graph model for multi-actor collaborative interaction plans.
 */

import { UserActor } from './user-journey';

export enum PlanNodeType {
  ActorAction = 'ActorAction',
  SystemTrigger = 'SystemTrigger',
  DecisionGate = 'DecisionGate',
  StateMilestone = 'StateMilestone',
}

export interface PlanNode {
  id: string;
  label: string;
  type: PlanNodeType;
  actor?: UserActor | 'System';
  screenViewId?: string;
  description: string;
}

export interface PlanEdge {
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  condition?: string;
}

export interface InteractionPlanEntry {
  id: string;
  title: string;
  summary: string;
  actors: UserActor[];
  nodes: PlanNode[];
  edges: PlanEdge[];
  relatedDataTypes: string[];
  relatedFlows: string[];
  relatedStories: string[];
  mermaidGraph: string;
}
