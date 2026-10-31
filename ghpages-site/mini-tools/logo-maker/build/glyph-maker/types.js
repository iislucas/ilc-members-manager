/* Shared types and enums for the I Liq Chuan Chinese Character SVG Maker. */
export const VIEWBOX_SIZE = 200;
export var GlyphId;
(function (GlyphId) {
    GlyphId["Yi"] = "yi";
    GlyphId["Li"] = "li";
    GlyphId["Quan"] = "quan";
})(GlyphId || (GlyphId = {}));
export var EditorBackdrop;
(function (EditorBackdrop) {
    EditorBackdrop["Overlay"] = "overlay";
    EditorBackdrop["Reference"] = "reference";
    EditorBackdrop["Generated"] = "generated";
})(EditorBackdrop || (EditorBackdrop = {}));
export var EditorTool;
(function (EditorTool) {
    EditorTool["Select"] = "select";
    EditorTool["AddStroke"] = "add_stroke";
})(EditorTool || (EditorTool = {}));
export function getEl(id) {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing required DOM element #${id}`);
    }
    return el;
}
