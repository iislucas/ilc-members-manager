import { UserTaxonomyNode, PersonaTaxonomyHierarchy } from '../models/user-taxonomy';
import { UserJourneyEntry } from '../models/user-journey';
export declare const USER_TAXONOMY_TREE: UserTaxonomyNode[];
export declare function flattenTaxonomy(nodes?: UserTaxonomyNode[]): UserTaxonomyNode[];
export declare function findTaxonomyNode(id: string, nodes?: UserTaxonomyNode[]): UserTaxonomyNode | undefined;
/**
 * Builds a structured, complete 3-level taxonomy hierarchy:
 * Level 1: Persona (User)
 *   -> Level 2: User Journeys (Owned + Participating)
 *     -> Level 3: Steps on the Journey (with screen route, data mutations, and inter-user handoffs)
 */
export declare function buildTaxonomyHierarchy(taxonomyNodes: UserTaxonomyNode[], journeys: UserJourneyEntry[]): PersonaTaxonomyHierarchy[];
//# sourceMappingURL=user-taxonomy-catalog.d.ts.map