/* arch-flow.ts
 *
 * Model defining end-to-end information flow pipelines.
 */

export enum FlowCategory {
  ClientReactivity = 'ClientReactivity',
  TriggerMirroring = 'TriggerMirroring',
  ECommerceWebhooks = 'ECommerceWebhooks',
  MediaTranscoding = 'MediaTranscoding',
  MicroFrontends = 'MicroFrontends',
  EmailAndNotifications = 'EmailAndNotifications',
}

export interface FlowStep {
  stepNumber: number;
  sourceTier: string;
  targetTier: string;
  action: string;
  payloadDescription: string;
  codePointers: string[];
}

export interface ArchFlowEntry {
  id: string;
  title: string;
  category: FlowCategory;
  summary: string;
  trigger: string;
  steps: FlowStep[];
  inputDataTypes: string[];
  outputDataTypes: string[];
  cloudFunctions: string[];
  clientServices: string[];
  diagramId?: string;
  mermaidDiagram?: string;
}
