"use strict";
/* data-type.ts
 *
 * Model defining a domain entity with 3 hierarchical levels of detail:
 * Level 1: Executive & Domain Summary
 * Level 2: Data Flow & Security Rules
 * Level 3: Full Technical Schema & Field Dictionary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataDomainGroup = void 0;
var DataDomainGroup;
(function (DataDomainGroup) {
    DataDomainGroup["IdentityAuth"] = "IdentityAuth";
    DataDomainGroup["OrganizationSchool"] = "OrganizationSchool";
    DataDomainGroup["CurriculumGrading"] = "CurriculumGrading";
    DataDomainGroup["EventsTicketing"] = "EventsTicketing";
    DataDomainGroup["MediaVod"] = "MediaVod";
    DataDomainGroup["CommerceFulfillment"] = "CommerceFulfillment";
    DataDomainGroup["CommunityContent"] = "CommunityContent";
    DataDomainGroup["SystemInfrastructure"] = "SystemInfrastructure";
})(DataDomainGroup || (exports.DataDomainGroup = DataDomainGroup = {}));
//# sourceMappingURL=data-type.js.map