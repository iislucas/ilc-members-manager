/* user-taxonomy-tree.component.ts
 *
 * Interactive D3.js hierarchical tree visualization of the ILC User Taxonomy.
 * Allows users to visually explore personas, click nodes to focus journeys & plans, and zoom/pan.
 */

import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  effect,
  inject,
  afterNextRender,
} from '@angular/core';
import * as d3 from 'd3';
import { DocsDataService } from '../../services/docs-data.service';
import { UserTaxonomyNode, TaxonomyCategory } from '../../../../../../docs/lib/src';

interface HierarchyNodeData {
  id: string;
  name: string;
  category?: TaxonomyCategory;
  summary?: string;
  isRoot?: boolean;
  isCategory?: boolean;
  rawNode?: UserTaxonomyNode;
  children?: HierarchyNodeData[];
}

@Component({
  selector: 'doc-user-taxonomy-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-taxonomy-tree.component.html',
  styleUrl: './user-taxonomy-tree.component.scss',
})
export class UserTaxonomyTreeComponent {
  protected docs = inject(DocsDataService);

  private readonly svgContainer = viewChild.required<ElementRef<SVGSVGElement>>('treeSvg');
  private zoomBehavior?: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private gRoot?: d3.Selection<SVGGElement, unknown, null, undefined>;

  constructor() {
    afterNextRender(() => {
      this.initTree();
    });

    // Re-render highlight whenever selected node changes
    effect(() => {
      const selected = this.docs.selectedTaxonomyNode();
      this.updateSelectionHighlight(selected?.id);
    });
  }

  private getCategoryColor(category?: TaxonomyCategory): string {
    switch (category) {
      case TaxonomyCategory.PublicAndProspective:
        return '#0284c7'; // Sky blue
      case TaxonomyCategory.MembersAndPractitioners:
        return '#16a34a'; // Emerald green
      case TaxonomyCategory.CertifiedInstructors:
        return '#d97706'; // Amber / Gold
      case TaxonomyCategory.InstitutionalAndEvents:
        return '#9333ea'; // Purple
      case TaxonomyCategory.GovernanceAndSystem:
        return '#dc2626'; // Crimson red
      default:
        return '#64748b'; // Slate
    }
  }

  private buildHierarchyData(): HierarchyNodeData {
    return {
      id: 'root',
      name: 'ILC Platform Actors',
      isRoot: true,
      children: this.docs.taxonomyTree.map((catGroup) => ({
        id: catGroup.id,
        name: catGroup.name,
        category: catGroup.category,
        isCategory: true,
        summary: catGroup.roleSummary,
        rawNode: catGroup,
        children: catGroup.children?.map((leaf) => ({
          id: leaf.id,
          name: leaf.name,
          category: leaf.category,
          summary: leaf.roleSummary,
          rawNode: leaf,
        })),
      })),
    };
  }

  private initTree(): void {
    const svgEl = this.svgContainer().nativeElement;
    const width = 1100;
    const height = 620;

    const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    // Setup Zoom
    const g = svg.append('g').attr('class', 'tree-viewport');
    this.gRoot = g;

    this.zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 2.5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(this.zoomBehavior);

    // Initial transform to center vertically and position on left
    const initialTransform = d3.zoomIdentity.translate(80, 20).scale(0.85);
    svg.call(this.zoomBehavior.transform, initialTransform);

    // Tree Layout
    const treeData = this.buildHierarchyData();
    const root = d3.hierarchy<HierarchyNodeData>(treeData);

    const treeLayout = d3.tree<HierarchyNodeData>().size([height - 60, width - 360]);
    treeLayout(root);

    // Render Links
    const linkGenerator = d3
      .linkHorizontal<d3.HierarchyPointLink<HierarchyNodeData>, d3.HierarchyPointNode<HierarchyNodeData>>()
      .x((d) => d.y)
      .y((d) => d.x);

    g.append('g')
      .attr('class', 'links')
      .selectAll('path')
      .data(root.links())
      .join('path')
      .attr('class', 'tree-link')
      .attr('d', (d: any) => linkGenerator(d) || '')
      .attr('stroke', (d) => {
        const cat = d.target.data.category;
        return this.getCategoryColor(cat);
      })
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.4)
      .attr('fill', 'none');

    // Render Nodes
    const node = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(root.descendants())
      .join('g')
      .attr('class', (d) => `tree-node ${d.data.isRoot ? 'node-root' : d.data.isCategory ? 'node-category' : 'node-leaf'}`)
      .attr('data-id', (d) => d.data.id)
      .attr('transform', (d) => `translate(${d.y},${d.x})`)
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        if (d.data.rawNode) {
          this.docs.selectTaxonomyNode(d.data.rawNode);
        }
      });

    // Outer Selection Ring
    node
      .append('circle')
      .attr('class', 'selection-ring')
      .attr('r', (d) => (d.data.isRoot ? 22 : d.data.isCategory ? 16 : 12))
      .attr('fill', 'none')
      .attr('stroke', (d) => this.getCategoryColor(d.data.category))
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0)
      .attr('stroke-dasharray', '3 2');

    // Node Body
    node
      .append('circle')
      .attr('class', 'node-circle')
      .attr('r', (d) => (d.data.isRoot ? 16 : d.data.isCategory ? 11 : 7))
      .attr('fill', (d) => (d.data.isRoot ? '#d97706' : this.getCategoryColor(d.data.category)))
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2.5);

    // Node Labels
    node
      .append('text')
      .attr('dy', '0.35em')
      .attr('x', (d) => (d.children ? -18 : 16))
      .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
      .text((d) => d.data.name)
      .attr('font-size', (d) => (d.data.isRoot ? '14px' : d.data.isCategory ? '12.5px' : '12px'))
      .attr('font-weight', (d) => (d.data.isRoot || d.data.isCategory ? '700' : '500'))
      .attr('fill', 'currentColor');

    // Badge / Subtitle for categories
    node
      .filter((d) => Boolean(d.data.isCategory))
      .append('text')
      .attr('dy', '1.6em')
      .attr('x', -18)
      .attr('text-anchor', 'end')
      .text((d) => `${d.children?.length || 0} personas`)
      .attr('font-size', '10px')
      .attr('font-weight', '400')
      .attr('fill', 'var(--text-muted)');

    // Highlight the currently selected node
    this.updateSelectionHighlight(this.docs.selectedTaxonomyNode()?.id);
  }

  private updateSelectionHighlight(selectedId?: string): void {
    if (!this.gRoot) return;

    this.gRoot.selectAll('.tree-node').each(function () {
      const nodeEl = d3.select(this);
      const id = nodeEl.attr('data-id');
      const isSelected = id === selectedId;

      nodeEl
        .select('.selection-ring')
        .transition()
        .duration(200)
        .attr('stroke-opacity', isSelected ? 1 : 0)
        .attr('r', isSelected ? 18 : 12);

      nodeEl
        .select('.node-circle')
        .transition()
        .duration(200)
        .attr('transform', isSelected ? 'scale(1.2)' : 'scale(1)');

      nodeEl
        .select('text')
        .style('fill', isSelected ? 'var(--primary)' : 'currentColor')
        .style('font-weight', isSelected ? '700' : '500');
    });
  }

  resetZoom(): void {
    const svgEl = this.svgContainer().nativeElement;
    const svg = d3.select(svgEl);
    if (this.zoomBehavior) {
      const transform = d3.zoomIdentity.translate(80, 20).scale(0.85);
      svg.transition().duration(400).call(this.zoomBehavior.transform, transform);
    }
  }

  fitView(): void {
    const svgEl = this.svgContainer().nativeElement;
    const svg = d3.select(svgEl);
    if (this.zoomBehavior) {
      const transform = d3.zoomIdentity.translate(20, 20).scale(0.72);
      svg.transition().duration(400).call(this.zoomBehavior.transform, transform);
    }
  }
}
