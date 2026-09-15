/* permission-entry.ts
 *
 * Model defining granted permissions, security rules mechanisms, read/write scopes,
 * and mappings between user personas and Firestore data types.
 */

export type PermissionAccessType = 'read' | 'write' | 'read-write' | 'admin' | 'system';

export interface PermissionEntry {
  id: string;                      // Unique permission token e.g. 'admin:all', 'member:self-write', 'grading:request'
  title: string;                   // Human-readable title e.g. "Member Self-Profile Update"
  category: string;                // Category e.g. "Identity & Profile", "Curriculum & Gradings", "Organization & Schools", etc.
  description: string;             // Detailed explanation of what this permission represents
  accessType: PermissionAccessType;// Access level granted
  targetDataTypes: string[];       // Referenced DataType IDs in DATA_TYPES_CATALOG e.g. ['member']
  securityRulesMechanism: string;  // How firestore.rules or Cloud Functions enforce this
  ruleCodeSnippet?: string;        // Exact code snippet or rule function from firestore.rules
  grantedPersonas: string[];       // Persona IDs from USER_TAXONOMY_TREE holding this permission
}
