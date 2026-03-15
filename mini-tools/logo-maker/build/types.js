/* Logo Maker – Shared types and DOM helpers.
 *
 * Defines the LogoParams interface and small DOM utility functions
 * used across all modules of the logo maker tool.
 */
// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
export const $ = (id) => document.getElementById(id);
export function numVal(id) {
    return parseFloat($(id).value);
}
export function strVal(id) {
    return $(id).value;
}
export function boolVal(id) {
    return $(id).checked;
}
export function setInputVal(id, val) {
    const el = $(id);
    if (el)
        el.value = String(val);
}
