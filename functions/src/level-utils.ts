export function canonicalizeGradingLevel(level: string): string {
  if (!level) return '';
  const lower = level.toLowerCase().trim();

  if (lower.startsWith('student level ')) {
    return 'Student ' + level.substring('student level '.length).trim();
  }
  if (lower.startsWith('application level ')) {
    return 'Application ' + level.substring('application level '.length).trim();
  }
  if (lower.startsWith('student ')) {
    return 'Student ' + level.substring('student '.length).trim();
  }
  if (lower.startsWith('application ')) {
    return 'Application ' + level.substring('application '.length).trim();
  }
  if (lower === 'entry' || !isNaN(Number(lower))) {
    return 'Student ' + level.trim();
  }
  return level.trim();
}

/**
 * Specifically for canonicalizing the studentLevel field of a Member
 */
export function canonicalizeStudentLevel(level: string): string {
  const canonical = canonicalizeGradingLevel(level);
  if (canonical === '') return '';
  if (canonical.startsWith('Student ')) return canonical;
  if (canonical.startsWith('Application ')) {
    // This shouldn't happen for a studentLevel field, but if it does, 
    // we keep the Application prefix.
    return canonical;
  }
  return 'Student ' + canonical;
}

/**
 * Specifically for canonicalizing the applicationLevel field of a Member
 */
export function canonicalizeApplicationLevel(level: string): string {
  if (!level) return '';
  const lower = level.toLowerCase().trim();
  if (lower.startsWith('application level ')) {
    return 'Application ' + level.substring('application level '.length).trim();
  }
  if (lower.startsWith('application ')) {
    return 'Application ' + level.substring('application '.length).trim();
  }
  if (!isNaN(Number(lower))) {
    return 'Application ' + level.trim();
  }
  return 'Application ' + level.trim();
}

export function extractLevelValue(level: string): { type: 'Student' | 'Application' | null, value: string } {
  const canonical = canonicalizeGradingLevel(level);
  if (canonical.startsWith('Student ')) {
    return { type: 'Student', value: canonical.substring('Student '.length) };
  }
  if (canonical.startsWith('Application ')) {
    return { type: 'Application', value: canonical.substring('Application '.length) };
  }
  return { type: null, value: canonical };
}
