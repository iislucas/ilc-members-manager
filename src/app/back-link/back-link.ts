import { Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../icons/icon.component';
import { NavigationTreeService } from '../navigation-tree';

/**
 * The in-page "Back to ..." link. It always points one level up the navigation
 * tree, so it matches the second-to-last breadcrumb by construction — see
 * NavigationTreeService. Renders nothing on a top-level page, which has no
 * parent to go back to.
 *
 * `jumpTo` adds a `jumpTo` param to the parent link, so a list scrolls to the
 * row you came from. Pages under a member list get this for free from the tree;
 * pass it only where the tree cannot know the row.
 */
@Component({
  selector: 'app-back-link',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (parent(); as p) {
      <a class="back-link subtle-button" [href]="p.url">
        <app-icon name="arrow_back"></app-icon> <span>Back to {{ p.label }}</span>
      </a>
    }
  `,
  styles: `
    /* Lay out as if the <a> were written directly in the host page, so the
       surrounding flex/grid containers keep working. */
    :host {
      display: contents;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      padding: 0.5rem;
      width: fit-content;
    }
  `,
})
export class BackLinkComponent {
  private navTree = inject(NavigationTreeService);

  jumpTo = input<string>('');

  protected parent = computed(() => {
    const p = this.navTree.parent();
    if (!p) return null;
    const jumpTo = this.jumpTo();
    if (!jumpTo) return p;
    const [path, query] = p.url.split('?');
    const params = new URLSearchParams(query ?? '');
    params.set('jumpTo', jumpTo);
    return { ...p, url: `${path}?${params.toString()}` };
  });
}
