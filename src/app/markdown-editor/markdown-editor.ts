/*
  A lightweight, touch-friendly Markdown editor for Angular 21 (Zoneless).

  ## Philosophy & Approach:
  1. Mobile-Friendly Design: The editor is optimized for both desktop and mobile screens.
     - Toolbar buttons are 44px touch targets and horizontally scrollable.
     - Layout adjusts to ensure the editor fills the available space without page scrolling.
  2. Zoneless Angular 21: Leverages signals and standalone components for maximum performance
     and minimal overhead without Zone.js.
  3. Minimal Milkdown Core: We avoid heavy presets like `milkdown/crepe` to maintain control
     over the UI and bundle size. We use only core plugins (commonmark, history, listener, indent).
  4. Custom UI over Default Themes: We provide our own CSS for markdown nodes (headings, lists)
      in `markdown-editor.scss` rather than relying on a heavy Milkdown theme plugin, ensuring a native feel.
  5. Focus Retention: Every action restores focus to the editor (`view.focus()`) to keep the
     mobile keyboard visible and preserve the user's cursor position.
  6. Web Component Friendly: The component is designed to be exported as a Custom Element for
     isolated testing and use in non-Angular contexts. It should also be possible simply to use this 
     as a library in the broader project.
*/

import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, output, effect, signal, computed, booleanAttribute, untracked } from '@angular/core';
import { Editor, rootCtx, commandsCtx, defaultValueCtx, editorViewCtx, parserCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/core';
import {
  commonmark,
  bulletListSchema,
  bulletListAttr,
  wrapInBulletListInputRule,
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  sinkListItemCommand,
  liftListItemCommand,
  insertImageCommand,
  imageSchema,
} from '@milkdown/preset-commonmark';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { indent as indentPlugin } from '@milkdown/plugin-indent';
import { $prose, $remark, $nodeSchema, $inputRule, $view } from '@milkdown/utils';
import { wrappingInputRule } from '@milkdown/prose/inputrules';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import { Decoration, DecorationSet, EditorView, NodeView } from '@milkdown/prose/view';
import { Node as ProseNode, Fragment } from '@milkdown/prose/model';
import { lift, wrapIn, splitBlock } from '@milkdown/prose/commands';
import { wrapInList, liftListItem, sinkListItem, splitListItem } from '@milkdown/prose/schema-list';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { IconComponent } from '../icons/icon.component';
import { ImageUploadPreviewComponent } from '../image-upload-preview/image-upload-preview';

// Content-producing toolbar actions that can be individually enabled. Used to
// restrict the editor to whatever subset the downstream renderer supports (e.g.
// the email template editor only allows bold + link). Undo/redo and
// clear-formatting are always available since they never introduce unsupported
// markup.
export type MarkdownFeature = 'bold' | 'italic' | 'heading' | 'bulletList' | 'orderedList' | 'indent' | 'link' | 'image' | 'note' | 'showBreaks';

// A generic, insertable, non-editable token surfaced by the editor. Chips are a
// pure view-layer concern: their `token` text lives verbatim in the markdown, so
// serialization/parsing is untouched — the editor only adds a one-click way to
// insert a token and renders any occurrences of it as a styled pill. Callers use
// this for placeholders (e.g. `{name}` in an email template), mentions, merge
// fields, etc.
export interface EditorChip {
  // Literal text inserted into and matched within the document, e.g. '{name}'.
  token: string;
  // Optional label for the insertion button; defaults to `token`.
  label?: string;
}

export class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private imgEl: HTMLImageElement;
  private captionInput: HTMLInputElement;
  private actionsEl: HTMLElement;
  private node: ProseNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private component: MarkdownEditor;

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    component: MarkdownEditor
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.component = component;

    const dom = document.createElement('span');
    dom.className = 'editor-image-figure';
    dom.contentEditable = 'false';
    this.dom = dom;

    const imgContainer = document.createElement('span');
    imgContainer.className = 'editor-image-container';

    const img = document.createElement('img');
    img.src = node.attrs['src'] || '';
    img.alt = node.attrs['alt'] || '';
    if (node.attrs['title']) {
      img.title = node.attrs['title'];
    }
    this.imgEl = img;

    img.addEventListener('click', () => {
      const pos = typeof this.getPos === 'function' ? this.getPos() : undefined;
      if (typeof pos === 'number') {
        const { state, dispatch } = this.view;
        const sel = NodeSelection.create(state.doc, pos);
        dispatch(state.tr.setSelection(sel));
      }
    });

    const actions = document.createElement('span');
    actions.className = 'editor-image-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'edit-btn';
    editBtn.title = 'Edit image';
    editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><span>Edit</span>`;
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = typeof this.getPos === 'function' ? this.getPos() : undefined;
      this.component.openImageDialog(pos, this.node.attrs);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.title = 'Delete image';
    deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg><span>Delete</span>`;
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = typeof this.getPos === 'function' ? this.getPos() : undefined;
      if (typeof pos === 'number') {
        this.component.removeImageAtPos(pos);
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    this.actionsEl = actions;

    imgContainer.appendChild(img);
    imgContainer.appendChild(actions);
    dom.appendChild(imgContainer);

    const captionInput = document.createElement('input');
    captionInput.type = 'text';
    captionInput.className = 'editor-image-caption-input';
    captionInput.placeholder = 'Add a caption (optional)...';
    captionInput.value = node.attrs['title'] || '';
    this.captionInput = captionInput;

    const commitCaption = () => {
      const newTitle = captionInput.value.trim();
      const currentTitle = this.node.attrs['title'] || '';
      if (newTitle !== currentTitle) {
        const pos = typeof this.getPos === 'function' ? this.getPos() : undefined;
        if (typeof pos === 'number') {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            title: newTitle || '',
          });
          this.view.dispatch(tr);
        }
      }
    };

    captionInput.addEventListener('blur', commitCaption);
    captionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCaption();
        captionInput.blur();
      } else if (e.key === 'Escape') {
        captionInput.value = this.node.attrs['title'] || '';
        captionInput.blur();
      }
    });

    dom.appendChild(captionInput);
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== 'image') return false;
    this.node = node;
    this.imgEl.src = node.attrs['src'] || '';
    this.imgEl.alt = node.attrs['alt'] || '';
    if (node.attrs['title']) {
      this.imgEl.title = node.attrs['title'];
    } else {
      this.imgEl.removeAttribute('title');
    }
    if (document.activeElement !== this.captionInput) {
      this.captionInput.value = node.attrs['title'] || '';
    }
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (target && (this.captionInput.contains(target) || this.actionsEl.contains(target))) {
      return true;
    }
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

@Component({
  selector: 'app-markdown-editor',
  imports: [IconComponent, ImageUploadPreviewComponent],
  templateUrl: './markdown-editor.html',
  styleUrl: './markdown-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class MarkdownEditor implements AfterViewInit, OnDestroy {
  initialValue = input<string>('');
  // Insertable placeholder tokens rendered as chips (see EditorChip). Empty by
  // default, so editors without chips behave exactly as before.
  chips = input<EditorChip[]>([]);
  // Optional custom image uploader. Receives the cropped image Blob and metadata,
  // returns the resolved public URL. When not provided, falls back to Firebase Storage
  // or a data URL.
  imageUploader = input<((blob: Blob, meta: { originalFile?: File; altText?: string }) => Promise<string>) | null>(null);
  // Which content-producing toolbar features to expose. `null` (the default)
  // shows all of them, preserving the full editor for existing callers; pass a
  // list to restrict to a supported subset.
  enabledFeatures = input<MarkdownFeature[] | null>(null);
  // Whether the editor renders its own border, rounded corners, and focus ring.
  bordered = input<boolean, unknown>(false, { transform: booleanAttribute });
  // Optional padding for the textual content of the editor. Defaults to '8px 12px'.
  // Set to false or '0' for no padding, or pass a custom CSS string.
  // The header/toolbar is not padded by this setting.
  textPadding = input<boolean | string>(true);

  protected resolvedTextPadding = computed(() => {
    const val = this.textPadding();
    if (val === false || val === 'false' || val === 'none' || val === '0') {
      return '0';
    }
    if (val === true || val === 'true' || val === '') {
      return '8px 12px';
    }
    return String(val);
  });

  changed = output<string>();
  menuOpen = signal<boolean>(true);
  isFullscreen = signal<boolean>(false);
  showDescriptions = signal<boolean>(false);
  canScrollLeft = signal<boolean>(false);
  canScrollRight = signal<boolean>(false);
  
  linkPopupOpen = signal<boolean>(false);
  linkPopupPos = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  linkUrl = signal<string>('');
  currentLinkRange = signal<{ from: number; to: number } | null>(null);
  
  linkPreviewOpen = signal<boolean>(false);
  linkPreviewPos = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  linkPreviewUrl = signal<string>('');

  imageModalOpen = signal<boolean>(false);
  imageSourceType = signal<'upload' | 'url'>('upload');
  imageAspectRatio = signal<number | null>(null);
  imageSizeChoice = signal<'large' | 'medium' | 'small'>('large');
  imageAltText = signal<string>('');
  imageCaption = signal<string>('');
  editingImagePos = signal<number | null>(null);
  imageUrlInput = signal<string>('');
  isUploadingImage = signal<boolean>(false);
  imageUploadError = signal<string | null>(null);
  readonly showBreaks = signal<boolean>(false);
  readonly isRawMode = signal<boolean>(false);
  readonly rawContent = signal<string>('');

  imageDimensions = computed(() => {
    const size = this.imageSizeChoice();
    const width = size === 'large' ? 1000 : size === 'medium' ? 600 : 300;
    const ratio = this.imageAspectRatio() || (3 / 2);
    const height = Math.round(width / ratio);
    return { width, height };
  });
  
  truncatedUrl = computed(() => {
    const url = this.linkPreviewUrl();
    if (!url) return '';
    if (url.length <= 40) return url;
    return url.substring(0, 20) + '...' + url.substring(url.length - 15);
  });

  private featureSet = computed(() => {
    const list = this.enabledFeatures();
    return list === null ? null : new Set(list);
  });

  // Whether a given content-producing toolbar feature should be shown. A null
  // feature set (the default) enables everything.
  protected has(feature: MarkdownFeature): boolean {
    const set = this.featureSet();
    return set === null || set.has(feature);
  }

  @ViewChild('editorRef') editorRef!: ElementRef;
  @ViewChild('contentWrapper') contentWrapperRef!: ElementRef;
  @ViewChild('editorContainer') containerRef!: ElementRef;
  @ViewChild('menuRef') menuRef?: ElementRef<HTMLElement>;
  @ViewChild('rawTextarea') rawTextareaRef?: ElementRef<HTMLTextAreaElement>;
  private lastRichHeight = 400;
  private menuResizeObserver?: ResizeObserver;
  private editor?: Editor;
  private isFirstLoad = true;
  private lastTap = 0;
  private tapCount = 0;
  private lastInputMarkdown = '';

  private safeScrollTo(top: number) {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top, behavior: 'instant' });
      } catch {
        // Fallback for jsdom/test environments
      }
    }
  }

  adjustRawTextareaHeight() {
    if (this.isFullscreen()) return;
    const el = this.rawTextareaRef?.nativeElement;
    if (!el) return;
    const currentScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    el.style.height = 'auto';
    const targetHeight = Math.max(el.scrollHeight, this.lastRichHeight, 400);
    el.style.height = `${targetHeight}px`;
    if (typeof window !== 'undefined' && window.scrollY !== currentScrollY) {
      this.safeScrollTo(currentScrollY);
    }
  }

  toggleMenu() {
    const nextState = !this.menuOpen();
    this.menuOpen.set(nextState);
    if (nextState) {
      setTimeout(() => {
        this.updateScrollState();
        this.setupMenuResizeObserver();
      }, 0);
    } else {
      this.menuResizeObserver?.disconnect();
    }
  }

  toggleFullscreen() {
    const next = !this.isFullscreen();
    this.isFullscreen.set(next);
    setTimeout(() => {
      this.updateScrollState();
      if (this.isRawMode()) {
        const el = this.rawTextareaRef?.nativeElement;
        if (el) {
          if (next) {
            el.style.height = '';
          } else {
            this.adjustRawTextareaHeight();
          }
        }
      }
    }, 50);
  }

  onEscape() {
    if (this.imageModalOpen()) {
      this.closeImageDialog();
      return;
    }
    if (this.isFullscreen()) {
      this.isFullscreen.set(false);
      setTimeout(() => {
        this.updateScrollState();
      }, 50);
    }
  }

  toggleDescriptions() {
    this.showDescriptions.set(!this.showDescriptions());
    setTimeout(() => this.updateScrollState(), 0);
  }

  updateScrollState() {
    const el = this.menuRef?.nativeElement;
    if (!el) {
      this.canScrollLeft.set(false);
      this.canScrollRight.set(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    this.canScrollLeft.set(scrollLeft > 1);
    this.canScrollRight.set(scrollLeft + clientWidth < scrollWidth - 1);
  }

  scrollToolbar(direction: 'left' | 'right') {
    const el = this.menuRef?.nativeElement;
    if (!el) return;
    const delta = direction === 'left' ? -120 : 120;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }

  private setupMenuResizeObserver() {
    this.menuResizeObserver?.disconnect();
    const el = this.menuRef?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    this.menuResizeObserver = new ResizeObserver(() => {
      this.updateScrollState();
    });
    this.menuResizeObserver.observe(el);
  }

  constructor() {
    effect(() => {
      const value = this.initialValue();
      if (value && this.isFirstLoad) {
        if (untracked(() => this.isRawMode())) {
          this.rawContent.set(value);
          setTimeout(() => this.adjustRawTextareaHeight(), 0);
        }
        if (this.editor) {
          this.setMarkdown(value);
          this.isFirstLoad = false; // Only set initially
        }
      }
    });
  }

  getMarkdown(): string {
    if (this.isRawMode()) {
      return this.rawContent();
    }
    let md = '';
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      md = serializer(view.state.doc);
    });
    return this.cleanSerializedMarkdown(md);
  }

  toggleRawMode() {
    const currentScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    if (this.isRawMode()) {
      // Switching from Raw to Rich Text
      const content = this.rawContent();
      this.isRawMode.set(false);
      this.setMarkdown(content);
      setTimeout(() => {
        this.safeScrollTo(currentScrollY);
        this.editor?.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.focus();
        });
      }, 0);
    } else {
      // Switching from Rich Text to Raw
      if (this.contentWrapperRef?.nativeElement) {
        this.lastRichHeight = Math.max(this.contentWrapperRef.nativeElement.offsetHeight, 400);
      }
      const content = this.getMarkdown();
      this.rawContent.set(content);
      this.isRawMode.set(true);
      setTimeout(() => {
        this.adjustRawTextareaHeight();
        this.safeScrollTo(currentScrollY);
        this.rawTextareaRef?.nativeElement?.focus({ preventScroll: true });
      }, 0);
    }
  }

  onRawInput(value: string) {
    this.rawContent.set(value);
    this.changed.emit(value);
    this.adjustRawTextareaHeight();
  }

  ngAfterViewInit() {
    this.initEditor();
    this.setupTapHandlers();
    this.setupLinkPreview();
    this.setupClickBelowContent();
    if (this.menuOpen()) {
      setTimeout(() => {
        this.updateScrollState();
        this.setupMenuResizeObserver();
      }, 0);
    }
  }
  
  private setupTapHandlers() {
    const el = this.editorRef.nativeElement;
    el.addEventListener('touchstart', (e: TouchEvent) => {
      const now = Date.now();
      if (now - this.lastTap < 300) {
        this.tapCount++;
      } else {
        this.tapCount = 1;
      }
      this.lastTap = now;

      if (this.tapCount === 2) {
        this.selectWord();
        e.preventDefault(); // Prevent default double tap zoom
      } else if (this.tapCount === 3) {
        this.selectLine();
        e.preventDefault();
      }
    }, { passive: false });
  }

  // When the user clicks in the empty space below the last line of
  // content, focus the editor and move the cursor to the very end.
  private setupClickBelowContent() {
    const wrapper = this.contentWrapperRef.nativeElement;
    const editorEl = this.editorRef.nativeElement;

    const handleClick = (e: MouseEvent) => {
      // Only act when the click target is the wrapper or the
      // editor-content container itself (i.e. empty space, not a
      // ProseMirror content node inside).
      if (e.target !== wrapper && e.target !== editorEl) return;

      this.editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        // Position inside the last block node (doc.content.size is
        // after the last block, which isn't a valid cursor position).
        const endPos = Math.max(0, state.doc.content.size - 1);
        // Use the same pattern as selectWord/selectLine in this file.
        const SelectionConstructor = state.selection.constructor as never as {
          create: (doc: typeof state.doc, pos: number) => typeof state.selection;
        };
        const sel = SelectionConstructor.create(state.doc, endPos);
        view.dispatch(state.tr.setSelection(sel));
        view.focus();
      });
    };

    wrapper.addEventListener('click', handleClick);
    editorEl.addEventListener('click', handleClick);
  }
  // Converts viewport-relative coordinates from ProseMirror's
  // coordsAtPos into coordinates relative to the editor container
  // element, so absolutely-positioned popups stay anchored when
  // the page scrolls.
  private toContainerCoords(
    coords: { left: number; bottom: number },
    estimatedWidth: number,
  ): { top: number; left: number } {
    const rect = this.containerRef.nativeElement.getBoundingClientRect();
    const containerWidth = rect.width;
    let left = coords.left - rect.left;

    if (left + estimatedWidth > containerWidth - 16) {
      left = containerWidth - estimatedWidth - 16;
    }
    if (left < 0) left = 0;

    return {
      top: coords.bottom - rect.top + 8,
      left,
    };
  }

  ngOnDestroy() {
    this.menuResizeObserver?.disconnect();
    this.editor?.destroy();
  }

  normalizeMarkdown(text: string): string {
    if (!text) return '';
    let res = text;

    // Convert 3 or more consecutive newlines into explicit empty lines with <br />
    // so CommonMark doesn't collapse them during AST parsing.
    res = res.replace(/\n{3,}/g, (match) => {
      const extraCount = match.length - 2;
      return '\n\n' + Array(extraCount).fill('<br />').join('\n\n') + '\n\n';
    });

    return res;
  }

  cleanSerializedMarkdown(text: string): string {
    if (!text) return '';
    let res = text;
    // Replace block <br /> between paragraphs back to standard blank lines
    res = res.replace(/\n\n[ \t]*<br\s*\/?>/g, '\n');
    // Replace leading block <br /> at start of document
    res = res.replace(/^[ \t]*<br\s*\/?>\n*/, '\n');
    return res;
  }

  private customBulletListSchema() {
    return $nodeSchema('bullet_list', (ctx) => ({
      content: 'listItem+',
      group: 'block',
      attrs: {
        spread: {
          default: false,
          validate: 'boolean',
        },
        bullet: {
          default: '*',
          validate: 'string',
        },
      },
      parseDOM: [
        {
          tag: 'ul',
          getAttrs: (dom) => {
            if (!(dom instanceof HTMLElement)) return false;
            return {
              spread: dom.dataset['spread'] === 'true',
              bullet: dom.dataset['bullet'] === '-' ? '-' : '*',
            };
          },
        },
      ],
      toDOM: (node) => {
        const bullet = node.attrs['bullet'] === '-' ? '-' : '*';
        return [
          'ul',
          {
            ...ctx.get(bulletListAttr.key)(node),
            'data-spread': node.attrs['spread'],
            'data-bullet': bullet,
            class: bullet === '-' ? 'list-dash' : 'list-star',
          },
          0,
        ];
      },
      parseMarkdown: {
        match: ({ type, ordered }: any) => type === 'list' && !ordered,
        runner: (state: any, node: any, type: any) => {
          const spread = node.spread != null ? `${node.spread}` : 'false';
          const bullet = node.bullet === '-' ? '-' : '*';
          state.openNode(type, { spread, bullet }).next(node.children).closeNode();
        },
      },
      toMarkdown: {
        match: (node: any) => node.type.name === 'bullet_list',
        runner: (state: any, node: any) => {
          const bullet = node.attrs['bullet'] === '-' ? '-' : '*';
          state
            .openNode('list', undefined, {
              ordered: false,
              spread: node.attrs['spread'],
              bullet,
            })
            .next(node.content)
            .closeNode();
        },
      },
    }));
  }

  private customWrapInBulletListInputRule(bulletSchema: any) {
    return $inputRule((ctx) =>
      wrappingInputRule(/^\s*([-+*])\s$/, bulletSchema.type(ctx), (match) => ({
        bullet: match[1] === '-' ? '-' : '*',
        spread: false,
      }))
    );
  }

  private preserveEmptyLineBlockPlugin() {
    return $remark('markdown-editor-preserve-empty-line-block', () => () => (ast: any, file: any) => {
      const source = file?.value ? String(file.value) : this.lastInputMarkdown;
      this.transformEmptyLineBlocks(ast, source);
    });
  }

  private transformEmptyLineBlocks(ast: any, source = '') {
    if (!ast || !ast.children) return;
    for (let i = 0; i < ast.children.length; i++) {
      const child = ast.children[i];

      // Detect list bullet type (* vs -)
      if (child.type === 'list' && !child.ordered) {
        let bullet = '*';
        const firstItem = child.children?.[0];
        const offset = firstItem?.position?.start?.offset;
        if (typeof offset === 'number' && source) {
          const slice = source.slice(offset, offset + 10).trimStart();
          if (slice.startsWith('-')) {
            bullet = '-';
          }
        }
        child.bullet = bullet;
      }

      if (
        child.type === 'html' &&
        ['<br />', '<br>', '<br >', '<br/>'].includes(child.value?.trim())
      ) {
        if (ast.type === 'root') {
          ast.children[i] = { type: 'paragraph', children: [] };
        }
      } else if (child.children) {
        this.transformEmptyLineBlocks(child, source);
      }
    }
  }

  private async initEditor() {
    this.lastInputMarkdown = this.initialValue() || '';
    const bulletSchema = this.customBulletListSchema();
    const bulletInputRule = this.customWrapInBulletListInputRule(bulletSchema);
    const filteredCommonmark = commonmark.filter(
      (p) =>
        !(bulletListSchema as unknown as unknown[]).includes(p) &&
        p !== wrapInBulletListInputRule
    );

    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, this.editorRef.nativeElement);
        ctx.set(defaultValueCtx, this.normalizeMarkdown(this.initialValue()));
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          handlers: {
            ...prev?.handlers,
            break: () => '\n',
            list: (node: any, parent: any, state: any, info: any) => {
              const prevBullet = state.bulletCurrent;
              const bullet = node.ordered
                ? (state.options?.bulletOrdered || '.')
                : (node.bullet === '-' ? '-' : '*');
              state.bulletCurrent = bullet;
              const exit = state.enter('list');
              const value = state.containerFlow(node, info);
              exit();
              state.bulletCurrent = prevBullet;
              return value;
            },
          },
        }));
        ctx.get(listenerCtx).markdownUpdated((ctx, markdown, prevMarkdown) => {
          this.changed.emit(this.cleanSerializedMarkdown(markdown));
        });
      })
      .use(bulletSchema)
      .use(bulletInputRule)
      .use(this.preserveEmptyLineBlockPlugin())
      .use(this.enterKeymapPlugin())
      .use(this.listKeymapPlugin())
      .use(this.tightListPlugin())
      .use(filteredCommonmark)
      .use(this.imageViewPlugin())
      .use(history)
      .use(listener)
      .use(indentPlugin)
      .use(this.chipDecorationPlugin())
      .use(this.breakMarksPlugin())
      .create();
    
    this.editor = editor;
    
    // If initialValue was already set before editor was ready
    const value = this.initialValue();
    if (value && this.isFirstLoad) {
      this.setMarkdown(value);
      this.isFirstLoad = false;
    }
  }

  private setMarkdown(markdown: string) {
    this.lastInputMarkdown = markdown;
    const normalized = this.normalizeMarkdown(markdown);
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      const doc = parser(normalized);
      if (!doc) return;
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc);
      view.dispatch(tr);
    });
  }

  // Inserts a chip's token text at the current selection, replacing any
  // selected range. The token is plain text, so it round-trips through the
  // markdown untouched and the decoration below re-styles it as a pill.
  insertChip(chip: EditorChip) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { from, to } = state.selection;
      view.dispatch(state.tr.insertText(chip.token, from, to));
      view.focus();
    });
  }

  // A ProseMirror plugin that decorates every occurrence of a configured chip
  // token with the `md-chip` class. Purely presentational: it adds no nodes or
  // marks, so the underlying document (and its markdown) is unchanged. Reads the
  // `chips` input lazily so it reflects whatever tokens are configured.
  private chipDecorationPlugin() {
    return $prose(() => new Plugin({
      key: new PluginKey('markdown-editor-chips'),
      props: {
        decorations: (state) => this.buildChipDecorations(state.doc),
      },
    }));
  }

  private buildChipDecorations(doc: ProseNode): DecorationSet {
    const tokens = this.chips().map((c) => c.token).filter((t) => t.length > 0);
    if (tokens.length === 0) return DecorationSet.empty;

    const decorations: Decoration[] = [];
    doc.descendants((node: ProseNode, pos: number) => {
      if (!node.isText || !node.text) return;
      const text = node.text;
      for (const token of tokens) {
        let idx = text.indexOf(token);
        while (idx !== -1) {
          const from = pos + idx;
          decorations.push(Decoration.inline(from, from + token.length, { class: 'md-chip' }));
          idx = text.indexOf(token, idx + token.length);
        }
      }
    });
    return DecorationSet.create(doc, decorations);
  }

  toggleShowBreaks() {
    const next = !this.showBreaks();
    this.showBreaks.set(next);
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const tr = view.state.tr.setMeta('showBreaks', next);
      view.dispatch(tr);
    });
  }

  private imageViewPlugin() {
    return $view(imageSchema.node, () => (node, view, getPos) => {
      return new ImageNodeView(node, view, getPos, this);
    });
  }

  private breakMarksPlugin() {
    return $prose(() => new Plugin({
      key: new PluginKey('markdown-editor-break-marks'),
      props: {
        decorations: (state) => {
          if (!this.showBreaks()) {
            return DecorationSet.empty;
          }
          return this.buildBreakMarkDecorations(state.doc);
        },
      },
    }));
  }

  private buildBreakMarkDecorations(doc: ProseNode): DecorationSet {
    const decorations: Decoration[] = [];

    doc.descendants((node: ProseNode, pos: number) => {
      if (node.type.name === 'hardbreak') {
        decorations.push(
          Decoration.widget(pos, () => {
            const span = document.createElement('span');
            span.className = 'editor-break-mark line-break-mark';
            span.textContent = '↵';
            return span;
          }, { side: -1 })
        );
      } else if (node.isText && node.text) {
        let idx = node.text.indexOf('\n');
        while (idx !== -1) {
          const charPos = pos + idx;
          decorations.push(
            Decoration.widget(charPos, () => {
              const span = document.createElement('span');
              span.className = 'editor-break-mark line-break-mark';
              span.textContent = '↵';
              return span;
            }, { side: -1 })
          );
          idx = node.text.indexOf('\n', idx + 1);
        }
      } else if (node.type.name === 'paragraph' && node.content.size === 0) {
        decorations.push(
          Decoration.widget(pos, () => {
            const span = document.createElement('span');
            span.className = 'editor-break-mark paragraph-break-mark';
            span.textContent = '¶';
            return span;
          }, { side: -1 })
        );
      }
    });

    return DecorationSet.create(doc, decorations);
  }

  toggleBold() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(toggleStrongCommand.key);
      view.focus();
    });
  }

  toggleItalic() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(toggleEmphasisCommand.key);
      view.focus();
    });
  }

  toggleBlockquote() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema, selection } = state;
      const { $from, $to } = selection;
      const blockquoteType = schema.nodes['blockquote'];
      if (!blockquoteType) return;

      let bqDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === blockquoteType) {
          bqDepth = d;
          break;
        }
      }

      if (bqDepth !== -1) {
        if (!lift(state, view.dispatch)) {
          const range = $from.blockRange($to);
          if (range) {
            view.dispatch(state.tr.lift(range, range.depth - 1));
          }
        }
      } else {
        wrapIn(blockquoteType)(state, view.dispatch);
      }

      view.focus();
    });
  }

  undo() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(undoCommand.key);
      view.focus();
    });
  }

  redo() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(redoCommand.key);
      view.focus();
    });
  }

  toggleBulletList() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema, selection } = state;
      const bulletListType = schema.nodes['bullet_list'];
      const orderedListType = schema.nodes['ordered_list'];
      const listItemType = schema.nodes['list_item'];

      const normSel = TextSelection.between(state.doc.resolve(selection.from), state.doc.resolve(selection.to));
      const activeState = (normSel.from !== selection.from || normSel.to !== selection.to)
        ? state.apply(state.tr.setSelection(normSel))
        : state;
      const { $from } = activeState.selection;

      let itemDepth = -1;
      let enclosingListType = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === listItemType) {
          itemDepth = d;
          enclosingListType = $from.node(d - 1).type;
          break;
        }
      }

      if (itemDepth === -1) {
        activeState.doc.nodesBetween(activeState.selection.from, activeState.selection.to, (node, pos) => {
          if (itemDepth === -1 && node.type === listItemType) {
            const $pos = activeState.doc.resolve(pos + 1);
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type === listItemType) {
                itemDepth = d;
                enclosingListType = $pos.node(d - 1).type;
                break;
              }
            }
          }
        });
      }

      if (itemDepth !== -1) {
        if (enclosingListType === bulletListType) {
          liftListItem(listItemType)(activeState, (tr) => {
            this.syncListItemAttributes(tr, activeState.selection.from, activeState.selection.to);
            view.dispatch(tr.scrollIntoView());
          });
        } else if (enclosingListType === orderedListType) {
          this.convertCurrentListItemType(view, itemDepth, bulletListType);
        } else {
          liftListItem(listItemType)(activeState, (tr) => {
            this.syncListItemAttributes(tr, activeState.selection.from, activeState.selection.to);
            view.dispatch(tr.scrollIntoView());
          });
        }
      } else {
        this.wrapSelectionInList(view, bulletListType);
      }

      view.focus();
    });
  }

  toggleOrderedList() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema, selection } = state;
      const bulletListType = schema.nodes['bullet_list'];
      const orderedListType = schema.nodes['ordered_list'];
      const listItemType = schema.nodes['list_item'];

      const normSel = TextSelection.between(state.doc.resolve(selection.from), state.doc.resolve(selection.to));
      const activeState = (normSel.from !== selection.from || normSel.to !== selection.to)
        ? state.apply(state.tr.setSelection(normSel))
        : state;
      const { $from } = activeState.selection;

      let itemDepth = -1;
      let enclosingListType = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === listItemType) {
          itemDepth = d;
          enclosingListType = $from.node(d - 1).type;
          break;
        }
      }

      if (itemDepth === -1) {
        activeState.doc.nodesBetween(activeState.selection.from, activeState.selection.to, (node, pos) => {
          if (itemDepth === -1 && node.type === listItemType) {
            const $pos = activeState.doc.resolve(pos + 1);
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type === listItemType) {
                itemDepth = d;
                enclosingListType = $pos.node(d - 1).type;
                break;
              }
            }
          }
        });
      }

      if (itemDepth !== -1) {
        if (enclosingListType === orderedListType) {
          liftListItem(listItemType)(activeState, (tr) => {
            this.syncListItemAttributes(tr, activeState.selection.from, activeState.selection.to);
            view.dispatch(tr.scrollIntoView());
          });
        } else if (enclosingListType === bulletListType) {
          this.convertCurrentListItemType(view, itemDepth, orderedListType);
        } else {
          liftListItem(listItemType)(activeState, (tr) => {
            this.syncListItemAttributes(tr, activeState.selection.from, activeState.selection.to);
            view.dispatch(tr.scrollIntoView());
          });
        }
      } else {
        this.wrapSelectionInList(view, orderedListType);
      }

      view.focus();
    });
  }

  private convertCurrentListItemType(view: any, itemDepth: number, targetType: any) {
    const { state } = view;
    const { $from, $to } = state.selection;
    const listDepth = itemDepth - 1;
    const listNode = $from.node(listDepth);
    const listPos = $from.before(listDepth);
    const isTargetOrdered = targetType.name === 'ordered_list';
    const attrs = isTargetOrdered ? { order: 1, spread: false } : { spread: false, bullet: '*' };

    let toItemDepth = itemDepth;
    for (let d = $to.depth; d > 0; d--) {
      if ($to.node(d).type === state.schema.nodes['list_item']) {
        toItemDepth = d;
        break;
      }
    }

    const fromIndex = $from.index(listDepth);
    const toIndex = $to.index(listDepth);

    if (fromIndex === 0 && toIndex >= listNode.childCount - 1) {
      let tr = state.tr.setNodeMarkup(listPos, targetType, attrs);
      listNode.forEach((child: any, offset: number, index: number) => {
        if (child.type === state.schema.nodes['list_item']) {
          const childPos = listPos + 1 + offset;
          const isDash = attrs.bullet === '-';
          const childAttrs = {
            ...child.attrs,
            listType: isTargetOrdered ? 'ordered' : 'bullet',
            label: isTargetOrdered ? `${index + 1}.` : (isDash ? '–' : (listDepth > 1 ? '◦' : '•')),
            spread: false,
          };
          tr = tr.setNodeMarkup(childPos, void 0, childAttrs);
        }
      });
      view.dispatch(tr);
      return;
    }

    const itemPos = $from.before(itemDepth);
    const itemEnd = $to.after(toItemDepth);
    let tr = state.tr;

    if (fromIndex > 0) {
      tr.split(itemPos, 1);
    }

    const mappedEnd = tr.mapping.map(itemEnd);
    if (toIndex < listNode.childCount - 1) {
      tr.split(mappedEnd, 1);
    }

    const mappedStart = tr.mapping.map(itemPos);
    const $mapped = tr.doc.resolve(mappedStart);
    const middleListPos = $mapped.before(listDepth);
    tr = tr.setNodeMarkup(middleListPos, targetType, attrs);

    const middleListNode = tr.doc.nodeAt(middleListPos);
    if (middleListNode) {
      middleListNode.forEach((child: any, offset: number, index: number) => {
        if (child.type === state.schema.nodes['list_item']) {
          const childPos = middleListPos + 1 + offset;
          const isDash = attrs.bullet === '-';
          const childAttrs = {
            ...child.attrs,
            listType: isTargetOrdered ? 'ordered' : 'bullet',
            label: isTargetOrdered ? `${index + 1}.` : (isDash ? '–' : (listDepth > 1 ? '◦' : '•')),
            spread: false,
          };
          tr = tr.setNodeMarkup(childPos, void 0, childAttrs);
        }
      });
    }

    view.dispatch(tr);
  }

  private splitHardbreaksInSelection(view: any): boolean {
    const { state } = view;
    const { from, to, empty } = state.selection;
    const { $from } = state.selection;

    let checkFrom = from;
    let checkTo = to;
    if (empty) {
      const depth = $from.depth;
      if (depth > 0 && $from.node(depth).type.name === 'paragraph') {
        checkFrom = $from.start(depth);
        checkTo = $from.end(depth);
      }
    }

    const splitPositions: { pos: number; size: number }[] = [];

    state.doc.nodesBetween(checkFrom, checkTo, (node: ProseNode, pos: number) => {
      if (node.type.name === 'hardbreak') {
        splitPositions.push({ pos, size: 1 });
      } else if (node.isText && node.text) {
        let idx = node.text.indexOf('\n');
        while (idx !== -1) {
          const charPos = pos + idx;
          if (charPos >= checkFrom && charPos < checkTo) {
            splitPositions.push({ pos: charPos, size: 1 });
          }
          idx = node.text.indexOf('\n', idx + 1);
        }
      }
    });

    if (splitPositions.length === 0) return false;

    let tr = state.tr;
    for (let i = splitPositions.length - 1; i >= 0; i--) {
      const { pos, size } = splitPositions[i];
      tr.delete(pos, pos + size);
      tr.split(pos);
    }

    view.dispatch(tr);
    return true;
  }

  private wrapSelectionInList(view: any, targetType: any) {
    this.splitHardbreaksInSelection(view);

    const { state } = view;
    const { selection } = state;
    const isOrdered = targetType.name === 'ordered_list';
    const attrs = isOrdered ? { order: 1, spread: false } : { spread: false, bullet: '*' };

    wrapInList(targetType, attrs)(view.state, (tr: any) => {
      this.syncListItemAttributes(tr, selection.from, selection.to);
      view.dispatch(tr.scrollIntoView());
    });
  }

  private syncListItemAttributes(tr: any, fromPos: number, toPos: number) {
    const listItemType = tr.doc.type.schema.nodes['list_item'];
    const orderedListType = tr.doc.type.schema.nodes['ordered_list'];
    const bulletListType = tr.doc.type.schema.nodes['bullet_list'];
    const minPos = Math.max(0, fromPos - 6);
    const maxPos = Math.min(tr.doc.content.size, toPos + 6);

    tr.doc.nodesBetween(minPos, maxPos, (node: ProseNode, pos: number) => {
      if ((node.type === bulletListType || node.type === orderedListType) && node.attrs['spread']) {
        tr.setNodeMarkup(pos, void 0, { ...node.attrs, spread: false });
      } else if (node.type === listItemType) {
        const $pos = tr.doc.resolve(pos + 1);
        const listDepth = $pos.depth - 1;
        if (listDepth >= 0) {
          const parentList = $pos.node(listDepth);
          const isOrdered = parentList.type === orderedListType;
          const bullet = parentList.attrs['bullet'] || '*';
          const isDash = bullet === '-';
          const index = $pos.index(listDepth);
          const childAttrs = {
            ...node.attrs,
            listType: isOrdered ? 'ordered' : 'bullet',
            label: isOrdered ? `${index + 1}.` : (isDash ? '–' : (listDepth > 1 ? '◦' : '•')),
            spread: false,
          };
          tr.setNodeMarkup(pos, void 0, childAttrs);
          if (parentList.attrs['spread']) {
            const parentPos = $pos.before(listDepth);
            tr.setNodeMarkup(parentPos, void 0, { ...parentList.attrs, spread: false });
          }
        }
      }
    });
  }

  wrapInHeading(level: number) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { heading, paragraph } = schema.nodes;

      const { $from, $to } = state.selection;
      const depth = $from.depth;

      if (depth === 0) return;

      const from = $from.before(depth);
      const to = $to.after(depth);

      const parent = $from.node(depth);
      const isHeading = parent.type.name === 'heading' && parent.attrs['level'] === level;

      const tr = state.tr;

      if (isHeading) {
        tr.setBlockType(from, to, paragraph);
      } else {
        tr.setBlockType(from, to, heading, { level });
      }

      view.dispatch(tr);
      view.focus();
    });
  }

  // Remove all inline marks (bold, italic, link, etc.) and reset block
  // types to paragraph. Operates on the current selection, or on the
  // whole block at the cursor when the selection is collapsed.
  clearFormatting() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { paragraph } = schema.nodes;
      const { $from, $to, empty } = state.selection;

      // Determine the range to clear: the selection itself, or the
      // entire block containing the cursor when nothing is selected.
      let from: number;
      let to: number;
      if (empty) {
        const depth = $from.depth;
        if (depth === 0) return;
        from = $from.before(depth);
        to = $from.after(depth);
      } else {
        from = $from.pos;
        to = $to.pos;
      }

      const tr = state.tr;

      // Strip every mark type from the range.
      for (const markType of Object.values(schema.marks)) {
        tr.removeMark(from, to, markType);
      }

      // Reset any block (headings, etc.) within the range to paragraph.
      tr.setBlockType(from, to, paragraph);

      view.dispatch(tr);
      view.focus();
    });
  }

  indent() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema, selection } = state;
      const { $from, $to } = selection;
      const listItemType = schema.nodes['list_item'];
      const bulletListType = schema.nodes['bullet_list'];
      const orderedListType = schema.nodes['ordered_list'];

      let itemDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === listItemType) {
          itemDepth = d;
          break;
        }
      }

      if (itemDepth === -1 && selection.from !== selection.to) {
        state.doc.nodesBetween(selection.from, selection.to, (node) => {
          if (itemDepth === -1 && node.type === listItemType) {
            itemDepth = 1;
            return false;
          }
          return true;
        });
      }

      if (itemDepth === -1) {
        this.wrapSelectionInList(view, bulletListType);
        view.focus();
        return;
      }

      const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild?.type === listItemType);
      if (!range) {
        view.focus();
        return;
      }

      if (range.startIndex > 0) {
        const didSink = sinkListItem(listItemType)(state, (tr) => {
          this.syncListItemAttributes(tr, range.start, range.end);
          view.dispatch(tr.scrollIntoView());
        });
        if (didSink) {
          view.focus();
          return;
        }
      }

      if (range.startIndex === 0 && range.endIndex > 1) {
        const firstChild = range.parent.child(0);
        const subFromPos = range.start + firstChild.nodeSize;
        const safeTo = Math.max(subFromPos, selection.to);
        const $subFrom = state.doc.resolve(Math.min(subFromPos + 1, state.doc.content.size));
        const $subTo = state.doc.resolve(Math.min(safeTo, state.doc.content.size));
        const subSel = TextSelection.between($subFrom, $subTo);
        const subState = state.apply(state.tr.setSelection(subSel));
        const didSink = sinkListItem(listItemType)(subState, (tr) => {
          this.syncListItemAttributes(tr, subFromPos, tr.mapping.map(selection.to));
          view.dispatch(tr.scrollIntoView());
        });
        if (didSink) {
          view.focus();
          return;
        }
      }

      // If we couldn't sink at the top level range, try sinking from $to if $to is in a nested list item
      if ($to.depth > itemDepth) {
        let nestedItemDepth = -1;
        for (let d = $to.depth; d > itemDepth; d--) {
          if ($to.node(d).type === listItemType) {
            nestedItemDepth = d;
            break;
          }
        }
        if (nestedItemDepth !== -1) {
          const nestedRange = $to.blockRange($to, (node) => node.childCount > 0 && node.firstChild?.type === listItemType);
          if (nestedRange && nestedRange.startIndex > 0) {
            const didSink = sinkListItem(listItemType)(state, (tr) => {
              this.syncListItemAttributes(tr, nestedRange.start, nestedRange.end);
              view.dispatch(tr.scrollIntoView());
            });
            if (didSink) {
              view.focus();
              return;
            }
          }
        }
      }

      // If at index 0, check if preceding block in parent is a list
      const listDepth = itemDepth - 1;
      const listNode = $from.node(listDepth);
      const parentOfList = $from.node(listDepth - 1);
      const listIndexInParent = $from.index(listDepth - 1);

      if (listIndexInParent > 0) {
        const prevBlock = parentOfList.child(listIndexInParent - 1);
        if (prevBlock.type === bulletListType || prevBlock.type === orderedListType) {
          const targetListItem = prevBlock.lastChild;
          if (targetListItem && targetListItem.type === listItemType) {
            const itemNode = $from.node(itemDepth);
            const listPos = $from.before(listDepth);
            const itemPos = $from.before(itemDepth);
            const isOnlyChild = listNode.childCount === 1;

            const deleteFrom = isOnlyChild ? listPos : itemPos;
            const deleteTo = isOnlyChild ? listPos + listNode.nodeSize : itemPos + itemNode.nodeSize;

            const tr = state.tr;
            tr.delete(deleteFrom, deleteTo);

            const lastChildOfTarget = targetListItem.lastChild;
            if (lastChildOfTarget && lastChildOfTarget.type === listNode.type) {
              const insertPos = listPos - 2;
              tr.insert(insertPos, itemNode);
              const selPos = Math.min(tr.doc.content.size, insertPos + 2);
              tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)));
            } else {
              const wrapped = listNode.type.create(listNode.attrs, Fragment.from(itemNode));
              const insertPos = listPos - 1;
              tr.insert(insertPos, wrapped);
              const selPos = Math.min(tr.doc.content.size, insertPos + 3);
              tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)));
            }

            this.syncListItemAttributes(tr, Math.max(0, listPos - 4), Math.min(tr.doc.content.size, listPos + 4));
            view.dispatch(tr.scrollIntoView());
            view.focus();
            return;
          }
        }
      }

      view.focus();
    });
  }

  unindent() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema, selection } = state;
      const listItemType = schema.nodes['list_item'];

      const normSel = TextSelection.between(state.doc.resolve(selection.from), state.doc.resolve(selection.to));
      const activeState = (normSel.from !== selection.from || normSel.to !== selection.to)
        ? state.apply(state.tr.setSelection(normSel))
        : state;

      let itemDepth = -1;
      for (let d = activeState.selection.$from.depth; d > 0; d--) {
        if (activeState.selection.$from.node(d).type === listItemType) {
          itemDepth = d;
          break;
        }
      }

      if (itemDepth === -1) {
        activeState.doc.nodesBetween(activeState.selection.from, activeState.selection.to, (node, pos) => {
          if (itemDepth === -1 && node.type === listItemType) {
            itemDepth = 1;
          }
        });
      }

      if (itemDepth === -1) {
        view.focus();
        return;
      }

      liftListItem(listItemType)(activeState, (tr) => {
        this.syncListItemAttributes(tr, activeState.selection.from, activeState.selection.to);
        view.dispatch(tr.scrollIntoView());
      });

      view.focus();
    });
  }

  private listKeymapPlugin() {
    return $prose(() => new Plugin({
      key: new PluginKey('markdown-editor-list-keymap'),
      props: {
        handleKeyDown: (view, event) => {
          if (event.key !== 'Tab') return false;
          const { state } = view;
          const { schema, selection } = state;
          const listItemType = schema.nodes['list_item'];
          let inList = false;
          for (let d = selection.$from.depth; d > 0; d--) {
            if (selection.$from.node(d).type === listItemType) {
              inList = true;
              break;
            }
          }
          if (!inList) {
            for (let d = selection.$to.depth; d > 0; d--) {
              if (selection.$to.node(d).type === listItemType) {
                inList = true;
                break;
              }
            }
          }
          if (!inList && selection.from !== selection.to) {
            state.doc.nodesBetween(selection.from, selection.to, (node) => {
              if (node.type === listItemType) {
                inList = true;
                return false;
              }
              return true;
            });
          }

          if (inList) {
            event.preventDefault();
            if (event.shiftKey) {
              this.unindent();
            } else {
              this.indent();
            }
            return true;
          }

          return false;
        },
      },
    }));
  }

  private tightListPlugin() {
    return $prose(() => new Plugin({
      key: new PluginKey('markdown-editor-tight-list'),
      appendTransaction: (transactions, oldState, newState) => {
        const docChanged = transactions.some((tr) => tr.docChanged);
        if (!docChanged) return null;

        const { schema } = newState;
        const listItemType = schema.nodes['list_item'];
        const bulletListType = schema.nodes['bullet_list'];
        const orderedListType = schema.nodes['ordered_list'];
        const hardbreakType = schema.nodes['hardbreak'];
        if (!listItemType && !hardbreakType) return null;

        let tr: any = null;
        newState.doc.descendants((node, pos) => {
          if (hardbreakType && node.type === hardbreakType && node.marks && node.marks.length > 0) {
            if (!tr) tr = newState.tr;
            tr.setNodeMarkup(pos, void 0, node.attrs, []);
          } else if ((node.type === bulletListType || node.type === orderedListType) && node.attrs['spread']) {
            if (!tr) tr = newState.tr;
            tr.setNodeMarkup(pos, void 0, { ...node.attrs, spread: false });
          } else if (node.type === listItemType) {
            let itemAttrs = node.attrs;
            let changed = false;
            if (node.childCount <= 1 && itemAttrs['spread']) {
              itemAttrs = { ...itemAttrs, spread: false };
              changed = true;
            }
            const $pos = newState.doc.resolve(pos + 1);
            if ($pos.depth > 1) {
              const parentList = $pos.node($pos.depth - 1);
              if (parentList.type === bulletListType) {
                const isDash = parentList.attrs['bullet'] === '-';
                const expectedLabel = isDash ? '–' : ($pos.depth - 1 > 1 ? '◦' : '•');
                if (itemAttrs['label'] !== expectedLabel) {
                  itemAttrs = { ...itemAttrs, label: expectedLabel, listType: 'bullet' };
                  changed = true;
                }
              }
            }
            if (changed) {
              if (!tr) tr = newState.tr;
              tr.setNodeMarkup(pos, void 0, itemAttrs);
            }
          }
        });

        return tr;
      },
    }));
  }

  private enterKeymapPlugin() {
    return $prose(() => new Plugin({
      key: new PluginKey('markdown-editor-enter-keymap'),
      props: {
        handleKeyDown: (view, event) => {
          if (event.key !== 'Enter') return false;

          const { state, dispatch } = view;
          const { schema, selection } = state;
          const hardbreakType = schema.nodes['hardbreak'];
          const listItemType = schema.nodes['list_item'];
          const headingType = schema.nodes['heading'];
          const codeBlockType = schema.nodes['code_block'] || schema.nodes['fence'];

          // 1. Shift-Enter: ALWAYS inserts a line break (<br>) without marks
          if (event.shiftKey) {
            if (hardbreakType) {
              const hardbreakNode = hardbreakType.create(null, null, []);
              const tr = state.tr.replaceSelectionWith(hardbreakNode, false).scrollIntoView();
              tr.setMeta('hardbreak', true);
              tr.setStoredMarks([]);
              dispatch(tr);
              return true;
            }
            return false;
          }

          // 2. Normal Enter:
          // If in a code block, let default handler insert newline
          if (codeBlockType) {
            for (let d = selection.$from.depth; d > 0; d--) {
              if (selection.$from.node(d).type === codeBlockType) {
                return false;
              }
            }
          }

          // If in a list item:
          if (listItemType) {
            let inListItem = false;
            let itemDepth = -1;
            for (let d = selection.$from.depth; d > 0; d--) {
              if (selection.$from.node(d).type === listItemType) {
                inListItem = true;
                itemDepth = d;
                break;
              }
            }

            if (inListItem) {
              const itemNode = selection.$from.node(itemDepth);
              const isItemEmpty = itemNode.textContent.trim().length === 0 && itemNode.childCount <= 1;
              if (isItemEmpty) {
                // Return on empty bullet exits list
                return liftListItem(listItemType)(state, (tr) => {
                  this.syncListItemAttributes(tr, selection.from, selection.to);
                  dispatch(tr.scrollIntoView());
                });
              } else {
                // Return on non-empty bullet creates next bullet (tight list)
                return splitListItem(listItemType, { spread: false })(state, (tr) => {
                  this.syncListItemAttributes(tr, selection.from, selection.to);
                  dispatch(tr.scrollIntoView());
                });
              }
            }
          }

          // If in a heading:
          if (headingType) {
            for (let d = selection.$from.depth; d > 0; d--) {
              if (selection.$from.node(d).type === headingType) {
                return splitBlock(state, dispatch);
              }
            }
          }

          // In standard text / paragraph:
          if (selection.empty) {
            const { $from } = selection;
            const prevNode = $from.nodeBefore;

            // At the very start of a block ($from.parentOffset === 0):
            // Return creates a line ABOVE (splits block)
            if ($from.parentOffset === 0) {
              return splitBlock(state, dispatch);
            }

            // Two consecutive Returns: cursor is immediately preceded by a hardbreak
            if (prevNode && prevNode.type === hardbreakType) {
              const pos = $from.pos;
              const tr = state.tr.delete(pos - 1, pos);
              const $newPos = tr.doc.resolve(pos - 1);
              const trSplit = tr.split($newPos.pos);
              dispatch(trSplit.scrollIntoView());
              return true;
            }

            // If the current block is completely empty, splitBlock creates a new paragraph
            if ($from.parent.content.size === 0) {
              return splitBlock(state, dispatch);
            }
          }

          // Single Return: insert a line break (<br>) without marks
          if (hardbreakType) {
            const hardbreakNode = hardbreakType.create(null, null, []);
            const tr = state.tr.replaceSelectionWith(hardbreakNode, false).scrollIntoView();
            tr.setMeta('hardbreak', true);
            tr.setStoredMarks([]);
            dispatch(tr);
            return true;
          }

          return false;
        },
      },
    }));
  }

  openImageDialog(pos?: number, currentAttrs?: { src?: string; alt?: string; title?: string }) {
    if (typeof pos === 'number') {
      this.editingImagePos.set(pos);
      this.imageUrlInput.set(currentAttrs?.src || '');
      this.imageAltText.set(currentAttrs?.alt || '');
      this.imageCaption.set(currentAttrs?.title || '');
      if (currentAttrs?.src) {
        this.imageSourceType.set('url');
      } else {
        this.imageSourceType.set('upload');
      }
    } else {
      this.editingImagePos.set(null);
      this.imageUrlInput.set('');
      this.imageAltText.set('');
      this.imageCaption.set('');
      this.imageSourceType.set('upload');
    }
    this.imageModalOpen.set(true);
    this.imageUploadError.set(null);
  }

  closeImageDialog() {
    this.imageModalOpen.set(false);
    this.editingImagePos.set(null);
    this.isUploadingImage.set(false);
    this.imageUploadError.set(null);
  }

  setAspectRatio(ratio: number | null) {
    this.imageAspectRatio.set(ratio);
  }

  setSizeChoice(size: 'large' | 'medium' | 'small') {
    this.imageSizeChoice.set(size);
  }

  insertImageUrl() {
    const url = this.imageUrlInput().trim();
    if (!url) return;
    const alt = this.imageAltText().trim();
    const title = this.imageCaption().trim() || null;
    const editingPos = this.editingImagePos();
    if (typeof editingPos === 'number') {
      this.updateImageAtPos(editingPos, url, alt, title);
    } else {
      this.insertImageIntoDoc(url, alt, title);
    }
    this.closeImageDialog();
  }

  async onImageCropped(event: { thumbBlob: Blob; largeBlob: Blob; originalFile?: File }) {
    this.isUploadingImage.set(true);
    this.imageUploadError.set(null);

    try {
      let downloadUrl = '';
      const customUploader = this.imageUploader();
      if (customUploader) {
        downloadUrl = await customUploader(event.largeBlob, {
          originalFile: event.originalFile,
          altText: this.imageAltText().trim(),
        });
      } else {
        downloadUrl = await this.defaultUpload(event.largeBlob, event.originalFile);
      }

      if (downloadUrl) {
        const alt = this.imageAltText().trim();
        const title = this.imageCaption().trim() || null;
        const editingPos = this.editingImagePos();
        if (typeof editingPos === 'number') {
          this.updateImageAtPos(editingPos, downloadUrl, alt, title);
        } else {
          this.insertImageIntoDoc(downloadUrl, alt, title);
        }
        this.closeImageDialog();
      }
    } catch (err: unknown) {
      console.error('Image upload failed:', err);
      this.imageUploadError.set((err as Error).message || 'Failed to upload image.');
    } finally {
      this.isUploadingImage.set(false);
    }
  }

  private insertImageIntoDoc(src: string, alt = '', title: string | null = null) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(insertImageCommand.key, { src, alt, title: title || ('' as any) });
      view.focus();
    });
  }

  updateImageAtPos(pos: number, src?: string, alt?: string, title?: string | null) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;
      const newAttrs = {
        ...node.attrs,
        ...(src !== undefined ? { src } : {}),
        ...(alt !== undefined ? { alt } : {}),
        ...(title !== undefined ? { title: title || '' } : {}),
      };
      const tr = view.state.tr.setNodeMarkup(pos, undefined, newAttrs);
      view.dispatch(tr);
      view.focus();
    });
  }

  removeImageAtPos(pos: number) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const node = view.state.doc.nodeAt(pos);
      const nodeSize = node ? node.nodeSize : 1;
      const tr = view.state.tr.delete(pos, pos + nodeSize);
      view.dispatch(tr);
      view.focus();
    });
  }

  removeCurrentImage() {
    const pos = this.editingImagePos();
    if (typeof pos === 'number') {
      this.removeImageAtPos(pos);
    }
    this.closeImageDialog();
  }

  saveImageDetailsOnly() {
    const pos = this.editingImagePos();
    if (typeof pos === 'number') {
      this.updateImageAtPos(
        pos,
        undefined,
        this.imageAltText().trim(),
        this.imageCaption().trim() || null
      );
    }
    this.closeImageDialog();
  }

  private async defaultUpload(blob: Blob, originalFile?: File): Promise<string> {
    try {
      const storage = getStorage();
      const filename = `img_${Date.now()}_${originalFile?.name || 'image.png'}`;
      const imgRef = storageRef(storage, `editor-images/${filename}`);
      await uploadBytes(imgRef, blob, { contentType: blob.type || 'image/png' });
      return await getDownloadURL(imgRef);
    } catch {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  }

  toggleLink() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { link } = schema.marks;
      
      if (!link) return;

      const { $from, $to } = state.selection;
      
      // Find if there is a link at the cursor
      const mark = $from.marks().find(m => m.type.name === 'link');
      
      if (mark) {
        const url = mark.attrs['href'];
        this.linkUrl.set(url);
        
        // Find range
        let $pos = $from;
        let from = $pos.pos;
        let to = $pos.pos;
        while (from > 0 && mark.isInSet(state.doc.resolve(from - 1).marks())) from--;
        while (to < state.doc.content.size && mark.isInSet(state.doc.resolve(to).marks())) to++;
        
        this.currentLinkRange.set({ from, to });
        
        // Get coordinates relative to the editor container so the
        // popup scrolls with the content instead of staying fixed.
        const coords = view.coordsAtPos($from.pos);
        this.linkPopupPos.set(this.toContainerCoords(coords, 320));
        
        this.linkPreviewOpen.set(false);
        this.linkPopupOpen.set(true);
      } else {
        // No link at cursor, use popup for new link (with or without selection)
        this.linkUrl.set('');
        this.currentLinkRange.set({ from: $from.pos, to: $to.pos });
        
        const coords = view.coordsAtPos($from.pos);
        this.linkPopupPos.set(this.toContainerCoords(coords, 320));
        
        this.linkPreviewOpen.set(false);
        this.linkPopupOpen.set(true);
      }
      view.focus();
    });
  }

  private selectWord() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { $from } = state.selection;
      const text = $from.parent.textContent;
      const offset = $from.parentOffset;

      let start = offset;
      while (start > 0 && /\w/.test(text[start - 1])) start--;
      let end = offset;
      while (end < text.length && /\w/.test(text[end])) end++;

      const posStart = $from.before() + 1 + start;
      const posEnd = $from.before() + 1 + end;

      const SelectionConstructor = state.selection.constructor as any;
      const newSelection = SelectionConstructor.create(state.doc, posStart, posEnd);
      
      view.dispatch(state.tr.setSelection(newSelection));
      view.focus();
    });
  }

  private selectLine() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { $from } = state.selection;
      
      // Select the whole parent block (paragraph, heading, etc.)
      const start = $from.before();
      const end = $from.after();

      const SelectionConstructor = state.selection.constructor as any;
      const newSelection = SelectionConstructor.create(state.doc, start, end);
      
      view.dispatch(state.tr.setSelection(newSelection));
      view.focus();
    });
  }

  updateLink(newUrl: string) {
    if (!newUrl) {
      this.linkPopupOpen.set(false);
      return; // Do nothing if empty!
    }

    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { link } = schema.marks;
      const range = this.currentLinkRange();
      
      if (range && link) {
        if (range.from === range.to) {
          // Empty range! Insert text node with mark!
          const node = schema.text(newUrl, [link.create({ href: newUrl })]);
          view.dispatch(state.tr.insert(range.from, node));
        } else {
          // Non-empty range! Add mark!
          const tr = state.tr
            .removeMark(range.from, range.to, link)
            .addMark(range.from, range.to, link.create({ href: newUrl }));
          view.dispatch(tr);
        }
      }
      this.linkPopupOpen.set(false);
      view.focus();
    });
  }

  removeLink() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { link } = schema.marks;
      const range = this.currentLinkRange();
      
      if (range && link) {
        view.dispatch(state.tr.removeMark(range.from, range.to, link));
      }
      this.linkPopupOpen.set(false);
      this.linkPreviewOpen.set(false);
      view.focus();
    });
  }

  private setupLinkPreview() {
    const el = this.editorRef.nativeElement;
    const checkLink = () => {
      // Wait for ProseMirror to update selection after click/keyup!
      setTimeout(() => {
        this.editor?.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { $from } = state.selection;
          const mark = $from.marks().find(m => m.type.name === 'link');
          
          if (mark) {
            const url = mark.attrs['href'];
            this.linkPreviewUrl.set(url);
            
            // Find range for remove/edit actions!
            let $pos = $from;
            let from = $pos.pos;
            let to = $pos.pos;
            while (from > 0 && mark.isInSet(state.doc.resolve(from - 1).marks())) from--;
            while (to < state.doc.content.size && mark.isInSet(state.doc.resolve(to).marks())) to++;
            
            this.currentLinkRange.set({ from, to });
            
            const coords = view.coordsAtPos($from.pos);
            this.linkPreviewPos.set(this.toContainerCoords(coords, 200));
            this.linkPreviewOpen.set(true);
          } else {
            this.linkPreviewOpen.set(false);
          }
        });
      }, 0);
    };
    
    el.addEventListener('click', checkLink);
    el.addEventListener('keyup', checkLink);
    el.addEventListener('touchstart', checkLink);
  }

  openLink() {
    const url = this.linkPreviewUrl();
    if (url) {
      window.open(url, '_blank');
    }
    this.linkPreviewOpen.set(false);
  }
}
