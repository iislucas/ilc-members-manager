/* interlink-resolver.ts
 *
 * Traverses documentation registries to build bidirectional cross-reference links
 * between Setup, Journeys, Plans, Data Types, Architecture Flows, Patterns, and Code Files.
 */

import { DataTypeEntry } from '../models/data-type';
import { UserJourneyEntry } from '../models/user-journey';
import { InteractionPlanEntry } from '../models/interaction-plan';
import { ArchFlowEntry } from '../models/arch-flow';
import { PatternEntry } from '../models/pattern-doc';
import { SetupGuideEntry } from '../models/setup-guide';
import { CodeFileEntry } from '../models/code-file';

export interface InterlinkRelations {
  relatedSetup: Array<{ id: string; title: string }>;
  relatedJourneys: Array<{ id: string; title: string }>;
  relatedPlans: Array<{ id: string; title: string }>;
  relatedDataTypes: Array<{ id: string; name: string }>;
  relatedFlows: Array<{ id: string; title: string }>;
  relatedPatterns: Array<{ id: string; name: string }>;
  relatedFiles: Array<{ path: string; responsibility: string }>;
}

export class InterlinkResolver {
  private dataTypes = new Map<string, DataTypeEntry>();
  private journeys = new Map<string, UserJourneyEntry>();
  private plans = new Map<string, InteractionPlanEntry>();
  private flows = new Map<string, ArchFlowEntry>();
  private patterns = new Map<string, PatternEntry>();
  private setupGuides = new Map<string, SetupGuideEntry>();
  private files = new Map<string, CodeFileEntry>();

  constructor(catalogs?: {
    dataTypes?: DataTypeEntry[];
    journeys?: UserJourneyEntry[];
    plans?: InteractionPlanEntry[];
    flows?: ArchFlowEntry[];
    patterns?: PatternEntry[];
    setupGuides?: SetupGuideEntry[];
    files?: CodeFileEntry[];
  }) {
    catalogs?.dataTypes?.forEach((d) => this.dataTypes.set(d.id, d));
    catalogs?.journeys?.forEach((j) => this.journeys.set(j.id, j));
    catalogs?.plans?.forEach((p) => this.plans.set(p.id, p));
    catalogs?.flows?.forEach((f) => this.flows.set(f.id, f));
    catalogs?.patterns?.forEach((p) => this.patterns.set(p.id, p));
    catalogs?.setupGuides?.forEach((s) => this.setupGuides.set(s.id, s));
    catalogs?.files?.forEach((f) => this.files.set(f.path, f));
  }

  /**
   * Resolves all forward and inverse relationships for a specific data type.
   */
  public resolveForDataType(typeId: string): InterlinkRelations {
    const dataType = this.dataTypes.get(typeId);
    const relatedJourneys: Array<{ id: string; title: string }> = [];
    const relatedPlans: Array<{ id: string; title: string }> = [];
    const relatedFlows: Array<{ id: string; title: string }> = [];
    const relatedPatterns: Array<{ id: string; name: string }> = [];
    const relatedSetup: Array<{ id: string; title: string }> = [];
    const relatedFiles: Array<{ path: string; responsibility: string }> = [];

    // Check inverse from journeys
    this.journeys.forEach((j) => {
      if (j.relatedDataTypes.includes(typeId)) {
        relatedJourneys.push({ id: j.id, title: j.title });
      }
    });

    // Check inverse from plans
    this.plans.forEach((p) => {
      if (p.relatedDataTypes.includes(typeId)) {
        relatedPlans.push({ id: p.id, title: p.title });
      }
    });

    // Check inverse from flows
    this.flows.forEach((f) => {
      if (f.inputDataTypes.includes(typeId) || f.outputDataTypes.includes(typeId)) {
        relatedFlows.push({ id: f.id, title: f.title });
      }
    });

    // Check patterns
    this.patterns.forEach((p) => {
      if (p.relatedDataTypes.includes(typeId)) {
        relatedPatterns.push({ id: p.id, name: p.name });
      }
    });

    // Check files
    this.files.forEach((f) => {
      if (f.relatedDataTypes.includes(typeId)) {
        relatedFiles.push({ path: f.path, responsibility: f.responsibility });
      }
    });

    return {
      relatedSetup,
      relatedJourneys,
      relatedPlans,
      relatedDataTypes: [],
      relatedFlows,
      relatedPatterns,
      relatedFiles,
    };
  }
}
