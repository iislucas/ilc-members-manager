/* tag-input.spec.ts
 *
 * Unit tests for TagInputComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagInputComponent } from './tag-input';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { TagItem } from '../../../functions/src/data-model';

describe('TagInputComponent', () => {
  let component: TagInputComponent;
  let fixture: ComponentFixture<TagInputComponent>;
  let mockDataService: {
    tagsSet: SearchableSet<'tag', TagItem>;
    getTagMeta: ReturnType<typeof vi.fn>;
    saveSystemTags: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockDataService = {
      tagsSet: new SearchableSet<'tag', TagItem>(['tag', 'label', 'description'], 'tag', [
        { tag: 'spinning', description: 'Circular energy' },
        { tag: 'basics', description: 'Foundations' },
      ]),
      getTagMeta: vi.fn((tag: string) => {
        if (tag === 'spinning') return { tag: 'spinning', description: 'Circular energy' };
        return undefined;
      }),
      saveSystemTags: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [TagInputComponent],
      providers: [{ provide: DataManagerService, useValue: mockDataService }],
    }).compileComponents();

    fixture = TestBed.createComponent(TagInputComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should add a valid tag and strip leading hashtags and spaces', () => {
    component.tags.set(['basics']);
    component.addTag('#Spinning ');

    expect(component.tags()).toEqual(['basics', 'spinning']);
    expect(mockDataService.saveSystemTags).toHaveBeenCalledWith(['spinning']);
  });

  it('should not add duplicate tags', () => {
    component.tags.set(['spinning']);
    component.addTag('spinning');
    expect(component.tags()).toEqual(['spinning']);
  });

  it('should remove a tag when removeTag is called', () => {
    component.tags.set(['spinning', 'basics']);
    component.removeTag('spinning');
    expect(component.tags()).toEqual(['basics']);
  });

  it('should return tag tooltip with description if available', () => {
    expect(component.getTagTooltip('spinning')).toBe('#spinning: Circular energy');
    expect(component.getTagTooltip('other')).toBe('#other');
  });

  it('should handle Enter key to add current text', () => {
    component.inputText.set('new_tag');
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    component.onKeydown(enterEvent);
    expect(component.tags()).toContain('new_tag');
  });
});
