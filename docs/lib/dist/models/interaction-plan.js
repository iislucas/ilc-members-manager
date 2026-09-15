"use strict";
/* interaction-plan.ts
 *
 * Directed node-edge graph model for multi-actor collaborative interaction plans.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanNodeType = void 0;
var PlanNodeType;
(function (PlanNodeType) {
    PlanNodeType["ActorAction"] = "ActorAction";
    PlanNodeType["SystemTrigger"] = "SystemTrigger";
    PlanNodeType["DecisionGate"] = "DecisionGate";
    PlanNodeType["StateMilestone"] = "StateMilestone";
})(PlanNodeType || (exports.PlanNodeType = PlanNodeType = {}));
//# sourceMappingURL=interaction-plan.js.map