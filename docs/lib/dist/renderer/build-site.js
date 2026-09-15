"use strict";
/* build-site.ts
 *
 * Compiles the 5-view knowledge base, 875+ file catalog, and MiniSearch index
 * into the interactive Documentation Website at docs/index.html.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSite = buildSite;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const data_types_catalog_1 = require("../catalog/data-types-catalog");
const journeys_catalog_1 = require("../catalog/journeys-catalog");
const plans_catalog_1 = require("../catalog/plans-catalog");
const stories_catalog_1 = require("../catalog/stories-catalog");
const flows_catalog_1 = require("../catalog/flows-catalog");
const setup_catalog_1 = require("../catalog/setup-catalog");
const patterns_catalog_1 = require("../catalog/patterns-catalog");
const files_catalog_1 = require("../catalog/files-catalog");
const code_link_resolver_1 = require("../resolvers/code-link-resolver");
const docs_search_index_1 = require("../search/docs-search-index");
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const OUTPUT_HTML = path.resolve(__dirname, '../../../index.html');
function generateSearchIndex() {
    const index = new docs_search_index_1.DocsSearchIndex();
    const searchDocs = [];
    // Setup guides
    setup_catalog_1.SETUP_CATALOG.forEach((s) => {
        searchDocs.push({
            id: `setup-${s.id}`,
            view: 'setup',
            title: s.title,
            subtitle: s.category,
            content: `${s.summary} ${s.commands.map((c) => `${c.command} ${c.explanation}`).join(' ')}`,
            tags: ['setup', 'emulator', 'deploy', s.category],
            url: `#setup-${s.id}`,
        });
    });
    // Journeys
    journeys_catalog_1.USER_JOURNEYS_CATALOG.forEach((j) => {
        searchDocs.push({
            id: `journey-${j.id}`,
            view: 'journeys',
            title: j.title,
            subtitle: `Actor: ${j.primaryActor}`,
            content: `${j.summary} ${j.steps.map((st) => `${st.title} ${st.description}`).join(' ')}`,
            tags: ['journey', j.primaryActor, ...j.relatedDataTypes],
            url: `#journey-${j.id}`,
        });
    });
    // Plans
    plans_catalog_1.PLANS_CATALOG.forEach((p) => {
        searchDocs.push({
            id: `plan-${p.id}`,
            view: 'plans',
            title: p.title,
            subtitle: 'Collaborative Interaction Plan',
            content: `${p.summary} ${p.nodes.map((n) => `${n.label} ${n.description}`).join(' ')}`,
            tags: ['plan', 'graph', ...p.actors, ...p.relatedDataTypes],
            url: `#plan-${p.id}`,
        });
    });
    // Data Types
    data_types_catalog_1.DATA_TYPES_CATALOG.forEach((d) => {
        searchDocs.push({
            id: `datatype-${d.id}`,
            view: 'datatypes',
            title: `${d.name} (${d.collectionPath})`,
            subtitle: d.domain,
            content: `${d.summary} ${d.fields.map((f) => `${f.name} ${f.description}`).join(' ')}`,
            tags: ['data', 'firestore', d.domain, d.name],
            url: `#datatype-${d.id}`,
        });
    });
    // Flows
    flows_catalog_1.FLOWS_CATALOG.forEach((f) => {
        searchDocs.push({
            id: `flow-${f.id}`,
            view: 'architecture',
            title: f.title,
            subtitle: f.category,
            content: `${f.summary} ${f.trigger} ${f.steps.map((st) => `${st.action} ${st.payloadDescription}`).join(' ')}`,
            tags: ['architecture', 'flow', f.category, ...f.cloudFunctions],
            url: `#flow-${f.id}`,
        });
    });
    // Patterns
    patterns_catalog_1.PATTERNS_CATALOG.forEach((p) => {
        searchDocs.push({
            id: `pattern-${p.id}`,
            view: 'patterns',
            title: p.name,
            subtitle: p.tagline,
            content: `${p.problem} ${p.solution} ${p.consequences}`,
            tags: ['pattern', 'architecture', ...p.relatedDataTypes],
            url: `#pattern-${p.id}`,
        });
    });
    // Stories
    stories_catalog_1.STORIES_CATALOG.forEach((st) => {
        searchDocs.push({
            id: `story-${st.id}`,
            view: 'stories',
            title: st.title,
            subtitle: `${st.area} (${st.status})`,
            content: `${st.role} ${st.capability} ${st.benefit} ${st.scenarios.map((sc) => `${sc.name} ${sc.given} ${sc.when} ${sc.then}`).join(' ')}`,
            tags: ['story', st.area, st.status],
            url: `#story-${st.id}`,
        });
    });
    index.addDocuments(searchDocs);
    return index.toJSON();
}
function buildSite() {
    const resolver = new code_link_resolver_1.CodeLinkResolver({ repoRoot: REPO_ROOT });
    const searchIndexJson = generateSearchIndex();
    const siteData = {
        setup: setup_catalog_1.SETUP_CATALOG,
        journeys: journeys_catalog_1.USER_JOURNEYS_CATALOG,
        surfaceMap: journeys_catalog_1.SITE_SURFACE_MAP,
        plans: plans_catalog_1.PLANS_CATALOG,
        dataTypes: data_types_catalog_1.DATA_TYPES_CATALOG,
        flows: flows_catalog_1.FLOWS_CATALOG,
        patterns: patterns_catalog_1.PATTERNS_CATALOG,
        stories: stories_catalog_1.STORIES_CATALOG,
        filesCount: files_catalog_1.FILES_CATALOG.length,
        filesSummary: {
            total: files_catalog_1.FILES_CATALOG.length,
            layers: files_catalog_1.FILES_CATALOG.reduce((acc, f) => {
                acc[f.layer] = (acc[f.layer] || 0) + 1;
                return acc;
            }, {}),
        },
        searchIndex: searchIndexJson,
    };
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ILC Members Manager — Unified System Documentation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="doc-style.css">
  <style>
    :root {
      --primary: #d97706;
      --primary-hover: #b45309;
      --primary-light: #fef3c7;
      --bg: #f8fafc;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    [data-theme="dark"] {
      --bg: #0b0f19;
      --surface: #131b2e;
      --border: #1e293b;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --primary-light: #451a03;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      z-index: 20;
    }
    .brand-title {
      font-weight: 700;
      font-size: 1.15rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .badge-pwa {
      background: var(--primary);
      color: white;
      font-size: 0.7rem;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-weight: 600;
    }
    .view-switcher {
      display: flex;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.2rem;
      gap: 0.2rem;
    }
    .view-btn {
      border: none;
      background: transparent;
      padding: 0.45rem 0.9rem;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-muted);
      transition: all 0.15s;
    }
    .view-btn.active, .view-btn:hover {
      background: var(--surface);
      color: var(--primary);
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .search-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      color: var(--text-muted);
      font-size: 0.85rem;
      cursor: pointer;
    }
    .search-kbd {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.1rem 0.35rem;
      font-size: 0.75rem;
      font-family: var(--font-mono);
    }
    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    aside.sidebar {
      width: 280px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow-y: auto;
    }
    .sidebar-section {
      padding: 0.75rem 1rem 0.25rem;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .sidebar-link {
      display: block;
      padding: 0.45rem 1rem;
      font-size: 0.85rem;
      color: var(--text);
      text-decoration: none;
      border-left: 3px solid transparent;
      transition: all 0.15s;
    }
    .sidebar-link:hover, .sidebar-link.active {
      background: var(--bg);
      color: var(--primary);
      border-left-color: var(--primary);
      font-weight: 600;
    }
    main.content {
      flex: 1;
      overflow-y: auto;
      padding: 2rem 3rem;
      scroll-behavior: smooth;
    }
    .content-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    .content-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .tag-badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: var(--primary-light);
      color: var(--primary);
      margin-right: 0.4rem;
    }
    .code-actions {
      display: flex;
      gap: 0.5rem;
    }
    .code-btn {
      font-size: 0.75rem;
      font-family: var(--font-mono);
      padding: 0.25rem 0.6rem;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      cursor: pointer;
    }
    .code-btn:hover {
      border-color: var(--primary);
      color: var(--primary);
    }
    .interlinks-panel {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px dashed var(--border);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.8rem;
    }
    .interlink-chip {
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      text-decoration: none;
      color: var(--text);
      font-weight: 500;
    }
    .interlink-chip:hover {
      border-color: var(--primary);
      color: var(--primary);
    }
    .level-tabs {
      display: flex;
      gap: 0.5rem;
      margin: 1rem 0;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
    }
    .level-tab {
      background: none;
      border: none;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
    }
    .level-tab.active {
      color: var(--primary);
      background: var(--primary-light);
    }
    pre {
      background: #0f172a !important;
      color: #f8fafc !important;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 0.85rem 1.15rem;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      line-height: 1.55;
      overflow-x: auto;
      margin: 0.4rem 0 0.8rem 0;
      position: relative;
    }
    [data-theme="dark"] pre {
      background: #070c18 !important;
      border-color: #1e293b;
      color: #f8fafc !important;
    }
    pre code {
      display: block;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      border-radius: 0;
      font-family: inherit;
      font-size: inherit;
      color: #f8fafc !important;
      overflow-x: visible;
      line-height: inherit;
    }
    code:not(pre code) {
      font-family: var(--font-mono);
      font-size: 0.825rem;
      background: var(--primary-light);
      color: var(--primary-hover);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-weight: 500;
    }
    [data-theme="dark"] code:not(pre code) {
      background: rgba(217, 119, 6, 0.25);
      color: #fbbf24;
    }
    .code-block-wrapper {
      position: relative;
      margin: 0.4rem 0 0.8rem 0;
    }
    .code-block-wrapper pre {
      margin: 0;
      padding-right: 4.8rem;
    }
    .copy-code-btn {
      position: absolute;
      top: 0.5rem;
      right: 0.6rem;
      background: rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 5px;
      font-size: 0.725rem;
      font-family: var(--font-sans);
      font-weight: 500;
      padding: 0.25rem 0.55rem;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      user-select: none;
      z-index: 5;
    }
    .copy-code-btn:hover {
      background: rgba(255, 255, 255, 0.25);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.35);
    }
    .copy-code-btn.copied {
      background: #059669;
      border-color: #10b981;
      color: #ffffff;
    }
    .search-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(3px);
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding-top: 10vh;
      z-index: 100;
    }
    .search-modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 90%;
      max-width: 640px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
      overflow: hidden;
    }
    .search-input-box {
      display: flex;
      align-items: center;
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    .search-input-box input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 1rem;
      color: var(--text);
      outline: none;
    }
    .search-results-list {
      max-height: 400px;
      overflow-y: auto;
      padding: 0.5rem 0;
    }
    .search-result-item {
      padding: 0.75rem 1.25rem;
      display: block;
      text-decoration: none;
      color: var(--text);
      border-bottom: 1px solid var(--border);
      transition: background 0.1s;
    }
    .search-result-item:hover, .search-result-item.selected {
      background: var(--bg);
    }
    .result-title {
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--primary);
    }
    .result-subtitle {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand-title">
      <span>ILC Portal Knowledge Base</span>
      <span class="badge-pwa">v0.0.1</span>
    </div>
    <div class="view-switcher">
      <button class="view-btn active" onclick="switchView('setup')">🚀 1. Setup & Instances</button>
      <button class="view-btn" onclick="switchView('journeys')">👥 2. Users, Journeys & Plans</button>
      <button class="view-btn" onclick="switchView('datatypes')">📦 3. Core Data Types</button>
      <button class="view-btn" onclick="switchView('architecture')">⚡ 4. Information Flow</button>
      <button class="view-btn" onclick="switchView('patterns')">🧩 5. Architectural Patterns</button>
      <button class="view-btn" onclick="switchView('files')">📁 Codebase Files (${siteData.filesCount})</button>
    </div>
    <div class="header-actions">
      <button class="search-btn" onclick="openSearch()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span>Search docs</span>
        <kbd class="search-kbd">⌘K</kbd>
      </button>
      <button class="view-btn" onclick="toggleTheme()" title="Toggle Dark/Light Mode">🌓</button>
    </div>
  </header>

  <div class="main-container">
    <aside class="sidebar" id="sidebarNav">
      <!-- Generated Sidebar Items -->
    </aside>

    <main class="content" id="mainContent">
      <!-- Rendered View Sections -->
    </main>
  </div>

  <!-- Search Modal -->
  <div class="search-modal-backdrop" id="searchModal" onclick="closeSearchOnBackdrop(event)">
    <div class="search-modal">
      <div class="search-input-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="text" id="searchInput" placeholder="Search files, data types, user stories, patterns, and flows..." oninput="handleSearch(this.value)">
        <kbd class="search-kbd">ESC</kbd>
      </div>
      <div class="search-results-list" id="searchResults">
        <div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">
          Type a query (e.g. <code>Grading</code>, <code>Stripe</code>, <code>initXxx</code>, <code>Transcoder</code>, <code>Member</code>)...
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/minisearch@7.1.2/dist/umd/index.min.js"></script>
  <script>
    const SITE_DATA = ${JSON.stringify(siteData)};
    let miniSearchInstance = null;

    try {
      miniSearchInstance = MiniSearch.loadJSON(SITE_DATA.searchIndex, {
        fields: ['title', 'subtitle', 'content', 'tags'],
        storeFields: ['id', 'view', 'title', 'subtitle', 'url']
      });
    } catch (e) {
      console.error('Failed to load search index:', e);
    }

    let currentView = 'setup';

    function switchView(view) {
      currentView = view;
      document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(view));
      });
      renderSidebar();
      renderContent();
      window.location.hash = '#' + view;
    }

    function renderSidebar() {
      const sb = document.getElementById('sidebarNav');
      let html = '';
      if (currentView === 'setup') {
        html += '<div class="sidebar-section">Setup & Instances</div>';
        SITE_DATA.setup.forEach(s => {
          html += \`<a href="#setup-\${s.id}" class="sidebar-link">\${s.title}</a>\`;
        });
      } else if (currentView === 'journeys') {
        html += '<div class="sidebar-section">Core User Journeys</div>';
        SITE_DATA.journeys.forEach(j => {
          html += \`<a href="#journey-\${j.id}" class="sidebar-link">\${j.title}</a>\`;
        });
        html += '<div class="sidebar-section">Multi-User Plans</div>';
        SITE_DATA.plans.forEach(p => {
          html += \`<a href="#plan-\${p.id}" class="sidebar-link">\${p.title}</a>\`;
        });
        html += '<div class="sidebar-section">Site Surface Map</div>';
        html += \`<a href="#surface-map" class="sidebar-link">All 97+ View Screens</a>\`;
      } else if (currentView === 'datatypes') {
        html += '<div class="sidebar-section">Core Data Models</div>';
        SITE_DATA.dataTypes.forEach(d => {
          html += \`<a href="#datatype-\${d.id}" class="sidebar-link">\${d.name} <span style="font-size:0.7rem;color:var(--text-muted)">(\${d.domain})</span></a>\`;
        });
      } else if (currentView === 'architecture') {
        html += '<div class="sidebar-section">Information Pipelines</div>';
        SITE_DATA.flows.forEach(f => {
          html += \`<a href="#flow-\${f.id}" class="sidebar-link">\${f.title}</a>\`;
        });
      } else if (currentView === 'patterns') {
        html += '<div class="sidebar-section">Architectural Patterns</div>';
        SITE_DATA.patterns.forEach(p => {
          html += \`<a href="#pattern-\${p.id}" class="sidebar-link">\${p.name}</a>\`;
        });
      } else if (currentView === 'files') {
        html += '<div class="sidebar-section">File Layers</div>';
        Object.entries(SITE_DATA.filesSummary.layers).forEach(([layer, count]) => {
          html += \`<a href="#layer-\${layer}" class="sidebar-link">\${layer} (\${count})</a>\`;
        });
      }
      sb.innerHTML = html;
    }

    function renderContent() {
      const mc = document.getElementById('mainContent');
      let html = '';

      if (currentView === 'setup') {
        html += '<h1>🚀 View 1: Setup & Instance Creation</h1>';
        html += '<p style="color:var(--text-muted);margin-bottom:2rem;">Prerequisites, local emulator workflow, seed data, and GCP cloud provisioning.</p>';
        SITE_DATA.setup.forEach(s => {
          html += \`
            <section id="setup-\${s.id}" class="content-card">
              <div class="content-header">
                <div>
                  <span class="tag-badge">\${s.category}</span>
                  <h2>\${s.title}</h2>
                </div>
              </div>
              <p style="margin-bottom:1rem;">\${s.summary}</p>
              \${s.prerequisites?.length ? \`
                <h4>Prerequisites:</h4>
                <ul style="margin:0.5rem 0 1rem 1.5rem;">
                  \${s.prerequisites.map(p => \`<li>\${p}</li>\`).join('')}
                </ul>
              \` : ''}
              <h4>Commands:</h4>
              <div style="margin:0.75rem 0;">
                \${s.commands.map(c => \`
                  <div style="margin-bottom:0.75rem;">
                    <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.25rem;">\${c.explanation}</div>
                    <div class="code-block-wrapper">
                      <pre><code>\${c.command}</code></pre>
                      <button class="copy-code-btn" onclick="copyCode(this)" title="Copy command">Copy</button>
                    </div>
                  </div>
                \`).join('')}
              </div>
              \${s.testAccounts ? \`
                <h4>Pre-seeded Test Accounts:</h4>
                <div style="overflow-x:auto;margin-top:0.5rem;">
                  <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                    <thead>
                      <tr style="text-align:left;border-bottom:1px solid var(--border);">
                        <th style="padding:0.4rem;">Persona</th>
                        <th style="padding:0.4rem;">Email</th>
                        <th style="padding:0.4rem;">Password</th>
                        <th style="padding:0.4rem;">Role Snapshot</th>
                      </tr>
                    </thead>
                    <tbody>
                      \${s.testAccounts.map(a => \`
                        <tr style="border-bottom:1px solid var(--border);">
                          <td style="padding:0.4rem;"><strong>\${a.persona}</strong></td>
                          <td style="padding:0.4rem;font-family:var(--font-mono);">\${a.email}</td>
                          <td style="padding:0.4rem;font-family:var(--font-mono);">\${a.password}</td>
                          <td style="padding:0.4rem;color:var(--text-muted);">\${a.roles}</td>
                        </tr>
                      \`).join('')}
                    </tbody>
                  </table>
                </div>
              \` : ''}
            </section>
          \`;
        });
      } else if (currentView === 'journeys') {
        html += '<h1>👥 View 2: Users, Key Journeys & Multi-User Plans</h1>';
        html += '<p style="color:var(--text-muted);margin-bottom:2rem;">User actors, collaborative interaction graphs (plans), and the 97+ view site surface map.</p>';

        html += '<h2 style="margin:2rem 0 1rem;">Multi-User Collaborative Interaction Graphs (Plans)</h2>';
        SITE_DATA.plans.forEach(p => {
          html += \`
            <section id="plan-\${p.id}" class="content-card">
              <div class="content-header">
                <div>
                  <span class="tag-badge">Collaborative Plan</span>
                  <h2>\${p.title}</h2>
                </div>
              </div>
              <p style="margin-bottom:1rem;">\${p.summary}</p>
              <h4>Participating Actors:</h4>
              <p style="margin:0.25rem 0 1rem;font-weight:600;color:var(--primary);">\${p.actors.join(' • ')}</p>
              <h4>Plan Sequence & Transitions:</h4>
              <ol style="margin:0.5rem 0 1.5rem 1.5rem;">
                \${p.nodes.map(n => \`
                  <li style="margin-bottom:0.4rem;">
                    <strong>\${n.actor ? \`[\${n.actor}] \` : ''}\${n.label}:</strong>
                    <span style="color:var(--text-muted);">\${n.description}</span>
                  </li>
                \`).join('')}
              </ol>
              <div class="interlinks-panel">
                <span style="font-weight:600;">Related Data Models:</span>
                \${p.relatedDataTypes.map(dt => \`<a href="#datatype-\${dt}" onclick="switchView('datatypes')" class="interlink-chip">📦 \${dt}</a>\`).join('')}
                <span style="font-weight:600;margin-left:1rem;">Related Flows:</span>
                \${p.relatedFlows.map(fl => \`<a href="#flow-\${fl}" onclick="switchView('architecture')" class="interlink-chip">⚡ \${fl}</a>\`).join('')}
              </div>
            </section>
          \`;
        });

        html += '<h2 style="margin:2.5rem 0 1rem;">Core User Journeys</h2>';
        SITE_DATA.journeys.forEach(j => {
          html += \`
            <section id="journey-\${j.id}" class="content-card">
              <div class="content-header">
                <div>
                  <span class="tag-badge">Primary Actor: \${j.primaryActor}</span>
                  <h2>\${j.title}</h2>
                </div>
              </div>
              <p style="margin-bottom:1rem;">\${j.summary}</p>
              <h4>Journey Steps:</h4>
              <div style="margin:0.75rem 0;">
                \${j.steps.map(st => \`
                  <div style="padding:0.6rem 0.8rem;background:var(--bg);border-radius:6px;margin-bottom:0.5rem;border-left:3px solid var(--primary);">
                    <div style="font-weight:600;font-size:0.9rem;">\${st.stepNumber}. [\${st.actor}] \${st.title}</div>
                    <div style="font-size:0.85rem;color:var(--text-muted);">\${st.description}</div>
                    \${st.screenPath ? \`<div style="font-size:0.75rem;font-family:var(--font-mono);margin-top:0.2rem;color:var(--primary);">Screen: \${st.screenPath}</div>\` : ''}
                  </div>
                \`).join('')}
              </div>
              <div class="interlinks-panel">
                <span style="font-weight:600;">Related Data Models:</span>
                \${j.relatedDataTypes.map(dt => \`<a href="#datatype-\${dt}" onclick="switchView('datatypes')" class="interlink-chip">📦 \${dt}</a>\`).join('')}
              </div>
            </section>
          \`;
        });

        html += '<h2 style="margin:2.5rem 0 1rem;" id="surface-map">Site Surface Map (97+ Views)</h2>';
        html += \`
          <div class="content-card" style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
              <thead>
                <tr style="text-align:left;border-bottom:2px solid var(--border);">
                  <th style="padding:0.6rem;">View ID</th>
                  <th style="padding:0.6rem;">Path Pattern</th>
                  <th style="padding:0.6rem;">Permitted Roles</th>
                  <th style="padding:0.6rem;">Objective</th>
                  <th style="padding:0.6rem;">Component File</th>
                </tr>
              </thead>
              <tbody>
                \${SITE_DATA.surfaceMap.map(s => \`
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:0.6rem;font-weight:600;">\${s.viewId}</td>
                    <td style="padding:0.6rem;font-family:var(--font-mono);color:var(--primary);">\${s.pathPattern}</td>
                    <td style="padding:0.6rem;">\${s.permittedRoles.join(', ')}</td>
                    <td style="padding:0.6rem;color:var(--text-muted);">\${s.objective}</td>
                    <td style="padding:0.6rem;font-family:var(--font-mono);font-size:0.75rem;">
                      <a href="vscode://file/\${s.componentFile}" class="code-btn">💻 Open</a>
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        \`;
      } else if (currentView === 'datatypes') {
        html += '<h1>📦 View 3: Core Data Types, Groups & Levels of Detail</h1>';
        html += '<p style="color:var(--text-muted);margin-bottom:2rem;">All 8 domain groups with selectable Level 1 (Executive Summary), Level 2 (Data Flow & Security), and Level 3 (Technical Schema).</p>';

        SITE_DATA.dataTypes.forEach(d => {
          html += \`
            <section id="datatype-\${d.id}" class="content-card">
              <div class="content-header">
                <div>
                  <span class="tag-badge">\${d.domain}</span>
                  <h2>\${d.name} <span style="font-size:0.9rem;font-family:var(--font-mono);color:var(--text-muted);">(\${d.collectionPath})</span></h2>
                </div>
                <div class="code-actions">
                  <a href="vscode://file/\${d.sourceFile}" class="code-btn">💻 VS Code</a>
                  <a href="https://github.com/iislucas/ilc-members-manager/blob/main/\${d.sourceFile}" target="_blank" class="code-btn">🌐 GitHub</a>
                </div>
              </div>

              <div class="level-tabs">
                <button class="level-tab active" onclick="toggleDetailLevel(this, 'l1-\${d.id}')">Level 1: Executive Summary</button>
                <button class="level-tab" onclick="toggleDetailLevel(this, 'l2-\${d.id}')">Level 2: Data Flow & Rules</button>
                <button class="level-tab" onclick="toggleDetailLevel(this, 'l3-\${d.id}')">Level 3: Technical Schema</button>
              </div>

              <!-- Level 1 -->
              <div id="l1-\${d.id}" class="detail-panel">
                <p style="margin-bottom:0.75rem;">\${d.summary}</p>
                <div style="font-size:0.85rem;margin-bottom:0.5rem;"><strong>Cardinality:</strong> \${d.cardinality}</div>
                <div style="font-size:0.85rem;margin-bottom:0.75rem;"><strong>Ownership:</strong> \${d.ownership}</div>
                \${d.keyRelations?.length ? \`
                  <h4>Core Relationships:</h4>
                  <ul style="margin:0.5rem 0 1rem 1.5rem;font-size:0.85rem;">
                    \${d.keyRelations.map(r => \`<li><strong>\${r.targetTypeName}:</strong> \${r.relation}</li>\`).join('')}
                  </ul>
                \` : ''}
              </div>

              <!-- Level 2 -->
              <div id="l2-\${d.id}" class="detail-panel" style="display:none;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;font-size:0.85rem;">
                  <div style="padding:0.75rem;background:var(--bg);border-radius:6px;">
                    <strong>Read Permissions:</strong>
                    <div>\${d.readRoles.join(', ')}</div>
                  </div>
                  <div style="padding:0.75rem;background:var(--bg);border-radius:6px;">
                    <strong>Write Permissions:</strong>
                    <div>\${d.writeRoles.join(', ')}</div>
                  </div>
                </div>
                <div style="font-size:0.85rem;margin-bottom:0.75rem;"><strong>Rules Summary:</strong> \${d.rulesSummary}</div>
                \${d.affectedTriggers?.length ? \`<div style="font-size:0.85rem;margin-bottom:0.5rem;"><strong>Attached Cloud Triggers:</strong> \${d.affectedTriggers.join(', ')}</div>\` : ''}
                \${d.mirrorTargets?.length ? \`<div style="font-size:0.85rem;margin-bottom:0.5rem;"><strong>Mirroring Targets:</strong> \${d.mirrorTargets.join(', ')}</div>\` : ''}
              </div>

              <!-- Level 3 -->
              <div id="l3-\${d.id}" class="detail-panel" style="display:none;">
                <h4>TypeScript Interface:</h4>
                <div class="code-block-wrapper">
                  <pre><code>\${d.tsInterface}</code></pre>
                  <button class="copy-code-btn" onclick="copyCode(this)" title="Copy interface">Copy</button>
                </div>
                <h4 style="margin-top:1rem;">Field Dictionary:</h4>
                <div style="overflow-x:auto;margin-top:0.5rem;">
                  <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
                    <thead>
                      <tr style="text-align:left;border-bottom:1px solid var(--border);">
                        <th style="padding:0.4rem;">Field</th>
                        <th style="padding:0.4rem;">Type</th>
                        <th style="padding:0.4rem;">Required</th>
                        <th style="padding:0.4rem;">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      \${d.fields.map(f => \`
                        <tr style="border-bottom:1px solid var(--border);">
                          <td style="padding:0.4rem;font-family:var(--font-mono);font-weight:600;">\${f.name}</td>
                          <td style="padding:0.4rem;font-family:var(--font-mono);color:var(--primary);">\${f.type}</td>
                          <td style="padding:0.4rem;">\${f.required ? 'Yes' : 'No'}</td>
                          <td style="padding:0.4rem;color:var(--text-muted);">\${f.description}</td>
                        </tr>
                      \`).join('')}
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="interlinks-panel">
                <span style="font-weight:600;">Related Journeys:</span>
                \${d.relatedJourneys.map(j => \`<a href="#journey-\${j}" onclick="switchView('journeys')" class="interlink-chip">👥 \${j}</a>\`).join('')}
                <span style="font-weight:600;margin-left:1rem;">Related Flows:</span>
                \${d.relatedFlows.map(fl => \`<a href="#flow-\${fl}" onclick="switchView('architecture')" class="interlink-chip">⚡ \${fl}</a>\`).join('')}
              </div>
            </section>
          \`;
        });
      } else if (currentView === 'architecture') {
        html += '<h1>⚡ View 4: Information Flow & System Architecture</h1>';
        html += '<p style="color:var(--text-muted);margin-bottom:2rem;">The 5 end-to-end data pipelines and multi-tier interaction flows.</p>';

        SITE_DATA.flows.forEach(f => {
          html += \`
            <section id="flow-\${f.id}" class="content-card">
              <div class="content-header">
                <div>
                  <span class="tag-badge">\${f.category}</span>
                  <h2>\${f.title}</h2>
                </div>
              </div>
              <p style="margin-bottom:1rem;">\${f.summary}</p>
              <div style="font-size:0.85rem;margin-bottom:1rem;"><strong>Trigger:</strong> \${f.trigger}</div>
              <h4>Pipeline Stages:</h4>
              <div style="margin:0.75rem 0;">
                \${f.steps.map(st => \`
                  <div style="padding:0.6rem 0.8rem;background:var(--bg);border-radius:6px;margin-bottom:0.5rem;border-left:3px solid var(--primary);">
                    <div style="display:flex;justify-content:space-between;margin-bottom:0.2rem;">
                      <span style="font-weight:600;font-size:0.85rem;">Step \${st.stepNumber}: \${st.sourceTier} ➔ \${st.targetTier}</span>
                      <span style="font-size:0.75rem;color:var(--text-muted);">\${st.action}</span>
                    </div>
                    <div style="font-size:0.8rem;color:var(--text-muted);">Payload: \${st.payloadDescription}</div>
                  </div>
                \`).join('')}
              </div>
              \${f.mermaidDiagram ? \`
                <h4>Pipeline Flowchart:</h4>
                <div class="code-block-wrapper">
                  <pre><code>\${f.mermaidDiagram}</code></pre>
                  <button class="copy-code-btn" onclick="copyCode(this)" title="Copy diagram definition">Copy</button>
                </div>
              \` : ''}
              <div class="interlinks-panel">
                <span style="font-weight:600;">Data Entities:</span>
                \${f.inputDataTypes.map(dt => \`<a href="#datatype-\${dt}" onclick="switchView('datatypes')" class="interlink-chip">📥 \${dt}</a>\`).join('')}
                \${f.outputDataTypes.map(dt => \`<a href="#datatype-\${dt}" onclick="switchView('datatypes')" class="interlink-chip">📤 \${dt}</a>\`).join('')}
              </div>
            </section>
          \`;
        });
      } else if (currentView === 'patterns') {
        html += '<h1>🧩 View 5: Core Architectural & Data Patterns in the Abstract</h1>';
        html += '<p style="color:var(--text-muted);margin-bottom:2rem;">The 10 design patterns and architectural idioms governing how the app is built.</p>';

        SITE_DATA.patterns.forEach(p => {
          html += \`
            <section id="pattern-\${p.id}" class="content-card">
              <div class="content-header">
                <div>
                  <span class="tag-badge">Design Pattern</span>
                  <h2>\${p.name}</h2>
                </div>
              </div>
              <p style="font-style:italic;color:var(--primary);margin-bottom:1rem;">\${p.tagline}</p>
              <div style="margin-bottom:1rem;">
                <h4>The Problem:</h4>
                <p style="color:var(--text-muted);margin-top:0.25rem;">\${p.problem}</p>
              </div>
              <div style="margin-bottom:1rem;">
                <h4>The Solution:</h4>
                <p style="color:var(--text);margin-top:0.25rem;">\${p.solution}</p>
              </div>
              <div style="margin-bottom:1rem;">
                <h4>Consequences & Guarantees:</h4>
                <p style="color:var(--text-muted);margin-top:0.25rem;">\${p.consequences}</p>
              </div>
              <h4>Canonical Implementation Code Pointers:</h4>
              <div style="margin:0.5rem 0;">
                \${p.canonicalCodePointers.map(c => \`
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0.6rem;background:var(--bg);border-radius:4px;margin-bottom:0.3rem;font-size:0.8rem;">
                    <div>
                      <span style="font-family:var(--font-mono);font-weight:600;">\${c.file}</span>
                      <span style="color:var(--text-muted);margin-left:0.5rem;">\${c.description}</span>
                    </div>
                    <a href="vscode://file/\${c.file}" class="code-btn">💻 Open \${c.lineRange || ''}</a>
                  </div>
                \`).join('')}
              </div>
            </section>
          \`;
        });
      } else if (currentView === 'files') {
        html += '<h1>📁 Codebase Files Catalog (100% Repository Index)</h1>';
        html += \`<p style="color:var(--text-muted);margin-bottom:2rem;">All \${SITE_DATA.filesCount} git-tracked files in the repository categorized by architectural layer.</p>\`;

        Object.entries(SITE_DATA.filesSummary.layers).forEach(([layer, count]) => {
          html += \`
            <section id="layer-\${layer}" class="content-card">
              <h3>\${layer} (\${count} files)</h3>
              <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:1rem;">Files in the \${layer} layer.</p>
              <div style="font-size:0.85rem;">
                Visit the search modal (⌘K) to query files by path, symbol, or responsibility.
              </div>
            </section>
          \`;
        });
      }

      mc.innerHTML = html;
    }

    function toggleDetailLevel(btn, targetId) {
      const parent = btn.closest('.content-card');
      parent.querySelectorAll('.level-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      parent.querySelectorAll('.detail-panel').forEach(p => p.style.display = 'none');
      const target = document.getElementById(targetId);
      if (target) target.style.display = 'block';
    }

    function openSearch() {
      document.getElementById('searchModal').style.display = 'flex';
      document.getElementById('searchInput').focus();
    }

    function closeSearch() {
      document.getElementById('searchModal').style.display = 'none';
    }

    function closeSearchOnBackdrop(e) {
      if (e.target.id === 'searchModal') closeSearch();
    }

    function handleSearch(query) {
      const sr = document.getElementById('searchResults');
      if (!query || !query.trim()) {
        sr.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">Type a query...</div>';
        return;
      }
      if (!miniSearchInstance) return;
      const results = miniSearchInstance.search(query).slice(0, 10);
      if (!results.length) {
        sr.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No matching entries found.</div>';
        return;
      }
      sr.innerHTML = results.map(r => \`
        <a href="\${r.url}" class="search-result-item" onclick="onSearchResultClick('\${r.view}')">
          <div class="result-title">[\${r.view.toUpperCase()}] \${r.title}</div>
          <div class="result-subtitle">\${r.subtitle || ''}</div>
        </a>
      \`).join('');
    }

    function onSearchResultClick(view) {
      closeSearch();
      switchView(view);
    }

    function toggleTheme() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    }

    function copyCode(btn) {
      const wrapper = btn.closest('.code-block-wrapper');
      const code = wrapper ? wrapper.querySelector('code') : null;
      if (!code) return;
      navigator.clipboard.writeText(code.innerText.trim()).then(() => {
        const origText = btn.innerText;
        btn.innerText = '✓ Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerText = origText;
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        btn.innerText = 'Copied';
      });
    }

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    });

    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
      const hash = window.location.hash.slice(1);
      if (hash && ['setup', 'journeys', 'datatypes', 'architecture', 'patterns', 'files'].includes(hash)) {
        switchView(hash);
      } else {
        switchView('setup');
      }
    });
  </script>
</body>
</html>
`;
    fs.writeFileSync(OUTPUT_HTML, htmlContent, 'utf-8');
    console.log(`Successfully compiled Documentation Website to ${OUTPUT_HTML}`);
}
if (require.main === module) {
    buildSite();
}
//# sourceMappingURL=build-site.js.map