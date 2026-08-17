/* docs/minitools/diagram-router/scripts/generate-architecture-diagram.ts
 *
 * Programmatic generator for the System Architecture & Orthogonal Interaction Graph.
 * Implements exact perpendicular 90-degree node docking, centered clearway corridors,
 * planar nested co-directional turn routing, and automated zero-crossing validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DiagramConfig,
  NodeDefinition,
  EdgeDefinition,
  OrthogonalDiagramRouter,
  renderPathsToSvg,
  isPointOnNodePerimeter,
  getPortPosition,
  findPathIntersections,
} from '../src';

const DOC_FILE = path.resolve(__dirname, '../../../orders-and-subscriptions.html');

// 1. Precise Grid-Aligned Node Definitions
export const diagramNodes: NodeDefinition[] = [
  // --- Tier 1: Client App (Upper Left) ---
  { id: 'client-me-portal', x: 38, y: 50, width: 194, height: 44, tier: 'client' },
  { id: 'client-stripe-service', x: 38, y: 106, width: 194, height: 44, tier: 'client' },
  { id: 'client-vod-catalog', x: 38, y: 162, width: 194, height: 44, tier: 'client' },
  { id: 'client-data-manager', x: 38, y: 245, width: 194, height: 46, tier: 'client' },

  // --- Tier 2: Cloud Functions (Upper Center) ---
  // Top 3 Callables: Centered & Wider (w: 300, x: 325..625)
  { id: 'func-cancel', x: 325, y: 50, width: 300, height: 36, tier: 'functions' },
  { id: 'func-resume', x: 325, y: 96, width: 300, height: 36, tier: 'functions' },
  { id: 'func-portal', x: 325, y: 142, width: 300, height: 36, tier: 'functions' },

  // Row 4: Playback & Webhook (Top-Aligned at y: 188)
  { id: 'func-playback', x: 295, y: 188, width: 175, height: 42, tier: 'functions' },
  { id: 'func-webhook', x: 488, y: 188, width: 168, height: 42, tier: 'functions' },

  // Row 5: Fulfillment & Grading Handlers (Top-Aligned at y: 245)
  { id: 'func-fulfillment', x: 295, y: 245, width: 175, height: 46, tier: 'functions' },
  { id: 'func-grading', x: 488, y: 245, width: 168, height: 46, tier: 'functions' },

  // --- Tier 3: Stripe Platform (Upper Right) ---
  { id: 'stripe-subs', x: 720, y: 50, width: 200, height: 46, tier: 'stripe' },
  { id: 'stripe-portal', x: 720, y: 106, width: 200, height: 46, tier: 'stripe' },
  { id: 'stripe-checkout', x: 720, y: 162, width: 200, height: 46, tier: 'stripe' },
  { id: 'stripe-webhook-stream', x: 720, y: 245, width: 200, height: 46, tier: 'stripe' },

  // --- Tier 4: Cloud Firestore Database (Bottom) ---
  { id: 'db-members', x: 38, y: 415, width: 210, height: 125, tier: 'firestore' },
  { id: 'db-orders', x: 264, y: 415, width: 208, height: 125, tier: 'firestore' },
  { id: 'db-videos', x: 488, y: 415, width: 212, height: 125, tier: 'firestore' },
  { id: 'db-acl', x: 716, y: 415, width: 204, height: 125, tier: 'firestore' },
];

// 2. Programmatic Edge Interconnections (with Perpendicular 90-Degree Docking & Planar Nested Channels)
export const diagramEdges: EdgeDefinition[] = [
  // --- Track 1: Client -> Callables (Channel X=264) ---
  {
    id: 'edge-client-to-cancel',
    from: { nodeId: 'client-stripe-service', side: 'right', fraction: 0.25 },
    to: { nodeId: 'func-cancel', side: 'left', fraction: 0.5 },
    corridorHints: { channelX: [258] },
    cssClass: 'svg-link-blue',
  },
  {
    id: 'edge-client-to-resume',
    from: { nodeId: 'client-stripe-service', side: 'right', fraction: 0.5 },
    to: { nodeId: 'func-resume', side: 'left', fraction: 0.5 },
    corridorHints: { channelX: [264] },
    cssClass: 'svg-link-blue',
  },
  {
    id: 'edge-client-to-portal',
    from: { nodeId: 'client-stripe-service', side: 'right', fraction: 0.75 },
    to: { nodeId: 'func-portal', side: 'left', fraction: 0.5 },
    corridorHints: { channelX: [258] }, // Disjoint from top lines -> uses primary track
    cssClass: 'svg-link-blue',
  },
  {
    id: 'edge-client-to-playback',
    from: { nodeId: 'client-vod-catalog', side: 'right', fraction: 0.5 },
    to: { nodeId: 'func-playback', side: 'left', fraction: 0.5 },
    corridorHints: { channelX: [258] }, // Disjoint from top lines -> uses primary track
    cssClass: 'svg-link-blue',
  },

  // --- Track 2: Callables -> Stripe Platform (Channel X=675) ---
  {
    id: 'edge-cancel-to-stripe',
    from: { nodeId: 'func-cancel', side: 'right', fraction: 0.5 },
    to: { nodeId: 'stripe-subs', side: 'left', fraction: 0.3913 }, // Exactly y=68
    cssClass: 'svg-link-purple',
  },
  {
    id: 'edge-resume-to-stripe',
    from: { nodeId: 'func-resume', side: 'right', fraction: 0.5 },
    to: { nodeId: 'stripe-subs', side: 'left', fraction: 0.826 }, // Exactly y=88
    corridorHints: { channelX: [675] },
    cssClass: 'svg-link-purple',
  },
  {
    id: 'edge-portal-to-stripe',
    from: { nodeId: 'func-portal', side: 'right', fraction: 0.5 },
    to: { nodeId: 'stripe-portal', side: 'left', fraction: 0.5 }, // Exactly y=129
    corridorHints: { channelX: [675] },
    cssClass: 'svg-link-purple',
  },

  // --- Track 3: Stripe Webhook -> Handlers (Amber & Purple) ---
  {
    id: 'edge-stripe-to-webhook',
    from: { nodeId: 'stripe-webhook-stream', side: 'left', fraction: 0.5 },
    to: { nodeId: 'func-webhook', side: 'right', fraction: 0.5 },
    corridorHints: { channelX: [688] },
    cssClass: 'svg-link-amber',
  },
  {
    id: 'edge-webhook-to-fulfillment',
    from: { nodeId: 'func-webhook', side: 'bottom', fraction: 0.3 },
    to: { nodeId: 'func-fulfillment', side: 'top', fraction: 0.75 },
    corridorHints: { channelY: [236] },
    cssClass: 'svg-link-purple',
  },

  // --- Track 4: Cloud Functions -> Cloud Firestore (Planar Consistent Bus) ---
  // Leftward disjoint paths & non-overlapping rightward path share primary baseline Y=350
  {
    id: 'edge-fulfillment-to-orders',
    from: { nodeId: 'func-fulfillment', side: 'bottom', fraction: 0.5 },
    to: { nodeId: 'db-orders', side: 'top', fraction: 0.5 },
    corridorHints: { channelY: [350] },
    cssClass: 'svg-link-green',
  },
  {
    id: 'edge-fulfillment-to-members',
    from: { nodeId: 'func-fulfillment', side: 'bottom', fraction: 0.25 },
    to: { nodeId: 'db-members', side: 'top', fraction: 0.6 },
    corridorHints: { channelY: [350] },
    cssClass: 'svg-link-green',
  },
  {
    id: 'edge-grading-to-acl',
    from: { nodeId: 'func-grading', side: 'bottom', fraction: 0.5 },
    to: { nodeId: 'db-acl', side: 'top', fraction: 0.5 },
    corridorHints: { channelY: [350] },
    cssClass: 'svg-link-green',
  },
  // Only the overlapping span (fulfillment -> videos spanning past grading origin x=572) steps to Y=370
  {
    id: 'edge-fulfillment-to-videos',
    from: { nodeId: 'func-fulfillment', side: 'bottom', fraction: 0.75 },
    to: { nodeId: 'db-videos', side: 'top', fraction: 0.5 },
    corridorHints: { channelY: [370] },
    cssClass: 'svg-link-green',
  },

  // --- Track 5: Realtime Firestore Listeners -> Angular Client (Blue Dashed) ---
  // Direct vertical line UP into DataManagerService (0 intersections)
  {
    id: 'edge-db-to-datamanager',
    from: { nodeId: 'db-members', side: 'top', fraction: 0.2952 },
    to: { nodeId: 'client-data-manager', side: 'bottom', fraction: 0.3196 },
    cssClass: 'svg-link-blue',
    dashed: true,
  },
];

export function validateAllEdgesAttached(nodes: NodeDefinition[], edges: EdgeDefinition[]): boolean {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let valid = true;

  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from.nodeId);
    const toNode = nodeMap.get(edge.to.nodeId);

    if (!fromNode || !toNode) {
      console.error(`✗ Edge ${edge.id} references missing node!`);
      valid = false;
      continue;
    }

    const pStart = getPortPosition(fromNode, edge.from);
    const pEnd = getPortPosition(toNode, edge.to);

    if (!isPointOnNodePerimeter(pStart, fromNode)) {
      console.error(`✗ Edge ${edge.id} start point (${pStart.x}, ${pStart.y}) is NOT on node ${fromNode.id} perimeter!`);
      valid = false;
    }

    if (!isPointOnNodePerimeter(pEnd, toNode)) {
      console.error(`✗ Edge ${edge.id} end point (${pEnd.x}, ${pEnd.y}) is NOT on node ${toNode.id} perimeter!`);
      valid = false;
    }
  }

  return valid;
}

export function generateArchitectureDiagramSvg(): string {
  const isAttached = validateAllEdgesAttached(diagramNodes, diagramEdges);
  if (!isAttached) {
    throw new Error('Edge perimeter validation failed! Please check node definitions.');
  }

  const config: DiagramConfig = {
    nodes: diagramNodes,
    edges: diagramEdges,
    laneSpacing: 6,
    cornerRadius: 4,
  };

  const router = new OrthogonalDiagramRouter(config);
  const { paths } = router.routeDiagram();

  // Automated assertion: Zero intersecting / overlapping paths
  const intersections = findPathIntersections(paths);
  if (intersections.length > 0) {
    const errorDetails = intersections.map((i: { edge1: string; edge2: string }) => `${i.edge1} <-> ${i.edge2}`).join(', ');
    throw new Error(`Planar validation failed! Intersecting paths detected: ${errorDetails}`);
  }

  return renderPathsToSvg(paths, { cornerRadius: 4 });
}

export function updateDocumentationHtml() {
  if (!fs.existsSync(DOC_FILE)) {
    console.error(`Documentation file not found at ${DOC_FILE}`);
    process.exit(1);
  }

  const generatedSvgPaths = generateArchitectureDiagramSvg();
  let content = fs.readFileSync(DOC_FILE, 'utf8');

  // Replace Client App node boxes in HTML
  const clientNodesHtml = `<!-- Tier 1: Client App (Upper Left) -->
            <rect x="25" y="20" width="220" height="330" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="4" />
            <text x="40" y="42" font-family="-apple-system, sans-serif" font-size="11.5" font-weight="700" fill="#2563eb">ANGULAR 21 CLIENT APP</text>

            <rect x="38" y="50" width="194" height="44" class="svg-node-box primary" />
            <text x="50" y="69" class="svg-text-title">Me Portal &amp; UI</text>
            <text x="50" y="85" class="svg-text-sub">/my-orders &amp; /me views</text>

            <rect x="38" y="106" width="194" height="44" class="svg-node-box primary" />
            <text x="50" y="125" class="svg-text-title">Stripe Service</text>
            <text x="50" y="141" class="svg-text-sub">Callable Functions SDK wrapper</text>

            <rect x="38" y="162" width="194" height="44" class="svg-node-box primary" />
            <text x="50" y="181" class="svg-text-title">VOD Catalog &amp; Player</text>
            <text x="50" y="197" class="svg-text-sub">/videos &amp; &lt;app-video-player&gt;</text>

            <rect x="38" y="245" width="194" height="46" class="svg-node-box primary" />
            <text x="50" y="264" class="svg-text-title">DataManagerService</text>
            <text x="50" y="281" class="svg-text-sub">Real-time Signal snapshot stores</text>`;

  // Replace Cloud Functions node boxes in HTML (Top 3 centered & wider, Row 4 top-aligned, Row 5 top-aligned)
  const funcNodesHtml = `<!-- Tier 2: Cloud Functions (Upper Center) -->
            <rect x="280" y="20" width="390" height="330" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="4" />
            <text x="295" y="42" font-family="-apple-system, sans-serif" font-size="11.5" font-weight="700" fill="#7c3aed">FIREBASE CLOUD FUNCTIONS</text>

            <!-- Top 3 Callables (Wider & Centered) -->
            <rect x="325" y="50" width="300" height="36" class="svg-node-box purple" />
            <text x="340" y="66" class="svg-text-title">cancelSubscription</text>
            <text x="340" y="79" class="svg-text-sub">Callable (Sets cancel_at_period_end)</text>

            <rect x="325" y="96" width="300" height="36" class="svg-node-box purple" />
            <text x="340" y="112" class="svg-text-title">resumeSubscription</text>
            <text x="340" y="125" class="svg-text-sub">Callable (Reactivates auto-renew)</text>

            <rect x="325" y="142" width="300" height="36" class="svg-node-box purple" />
            <text x="340" y="158" class="svg-text-title">createCustomerPortal</text>
            <text x="340" y="171" class="svg-text-sub">Generates single-use Stripe URL</text>

            <!-- Row 4: Playback & Webhook (Top-Aligned) -->
            <rect x="295" y="188" width="175" height="42" class="svg-node-box purple" />
            <text x="306" y="206" class="svg-text-title">getVideoPlaybackSession</text>
            <text x="306" y="221" class="svg-text-sub">Evaluates 7-tier gating cascade</text>

            <rect x="488" y="188" width="168" height="42" class="svg-node-box purple" />
            <text x="500" y="206" class="svg-text-title">stripeWebhook</text>
            <text x="500" y="221" class="svg-text-sub">HTTP endpoint &amp; HMAC check</text>

            <!-- Row 5: Fulfillment & Grading Handlers (Top-Aligned) -->
            <rect x="295" y="245" width="175" height="46" class="svg-node-box purple" />
            <text x="306" y="264" class="svg-text-title">stripe-fulfillment.ts</text>
            <text x="306" y="280" class="svg-text-sub">Modular Business Handlers</text>

            <rect x="488" y="245" width="168" height="46" class="svg-node-box purple" />
            <text x="500" y="264" class="svg-text-title">on-grading-update.ts</text>
            <text x="500" y="280" class="svg-text-sub">Triggers, mirrors &amp; notifs</text>`;

  // Stripe Platform boxes with updated Y alignment
  const stripeNodesHtml = `<!-- Tier 3: Stripe Platform (Upper Right) -->
            <rect x="705" y="20" width="230" height="330" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="4" />
            <text x="720" y="42" font-family="-apple-system, sans-serif" font-size="11.5" font-weight="700" fill="#0284c7">STRIPE BILLING PLATFORM</text>

            <rect x="720" y="50" width="200" height="46" class="svg-node-box accent" />
            <text x="734" y="69" class="svg-text-title">Subscriptions API</text>
            <text x="734" y="85" class="svg-text-sub">cancel_at_period_end update</text>

            <rect x="720" y="106" width="200" height="46" class="svg-node-box accent" />
            <text x="734" y="125" class="svg-text-title">Customer Billing Portal</text>
            <text x="734" y="141" class="svg-text-sub">Hosted Cards &amp; Tax Invoices</text>

            <rect x="720" y="162" width="200" height="46" class="svg-node-box accent" />
            <text x="734" y="181" class="svg-text-title">Checkout Sessions</text>
            <text x="734" y="197" class="svg-text-sub">One-click buy &amp; recurring subs</text>

            <rect x="720" y="245" width="200" height="46" class="svg-node-box amber" />
            <text x="734" y="264" class="svg-text-title">Webhook Event Stream</text>
            <text x="734" y="280" class="svg-text-sub">invoice.paid / checkout / sub.*</text>`;

  const oldClientMarker = '<!-- Tier 1: Client App (Upper Left) -->';
  const oldFuncMarker = '<!-- Tier 2: Cloud Functions (Upper Center) -->';
  const oldStripeMarker = '<!-- Tier 3: Stripe Platform (Upper Right) -->';
  const oldFirestoreMarker = '<!-- ================= BOTTOM TIER: FIRESTORE DATABASE ================= -->';

  const clientStart = content.indexOf(oldClientMarker);
  const funcStart = content.indexOf(oldFuncMarker);
  const stripeStart = content.indexOf(oldStripeMarker);
  const firestoreStart = content.indexOf(oldFirestoreMarker);

  if (clientStart !== -1 && funcStart !== -1 && stripeStart !== -1 && firestoreStart !== -1) {
    content =
      content.slice(0, clientStart) +
      clientNodesHtml +
      '\n\n            ' +
      funcNodesHtml +
      '\n\n            ' +
      stripeNodesHtml +
      '\n\n            ' +
      content.slice(firestoreStart);
  }

  const startMarker = '<!-- ================= ORTHOGONAL 90-DEGREE TRACK ROUTING ================= -->';
  const endMarker = '</svg>';

  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker, startIndex);

  if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find diagram routing markers in documentation file.');
    process.exit(1);
  }

  const before = content.slice(0, startIndex + startMarker.length);
  const after = content.slice(endIndex);

  const updatedContent = `${before}\n\n${generatedSvgPaths}\n          ${after}`;
  fs.writeFileSync(DOC_FILE, updatedContent, 'utf8');
  console.log(`✓ Successfully validated 0 intersections and updated diagram in ${DOC_FILE}`);
}

if (require.main === module) {
  updateDocumentationHtml();
}
