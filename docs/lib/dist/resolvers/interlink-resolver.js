"use strict";
/* interlink-resolver.ts
 *
 * Traverses documentation registries to build bidirectional cross-reference links
 * between Setup, Journeys, Plans, Data Types, Architecture Flows, Patterns, and Code Files.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterlinkResolver = void 0;
class InterlinkResolver {
    dataTypes = new Map();
    journeys = new Map();
    plans = new Map();
    flows = new Map();
    patterns = new Map();
    setupGuides = new Map();
    files = new Map();
    constructor(catalogs) {
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
    resolveForDataType(typeId) {
        const dataType = this.dataTypes.get(typeId);
        const relatedJourneys = [];
        const relatedPlans = [];
        const relatedFlows = [];
        const relatedPatterns = [];
        const relatedSetup = [];
        const relatedFiles = [];
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
exports.InterlinkResolver = InterlinkResolver;
//# sourceMappingURL=interlink-resolver.js.map