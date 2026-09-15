/* pattern-doc.ts
 *
 * Model defining core architectural and data patterns in the abstract (View 5).
 */

export interface CodePointer {
  file: string;
  lineRange?: string;
  symbol?: string;
  description: string;
}

export interface PatternEntry {
  id: string;
  name: string;
  tagline: string;
  problem: string;
  solution: string;
  consequences: string;
  canonicalCodePointers: CodePointer[];
  relatedDataTypes: string[];
  relatedFlows: string[];
}
