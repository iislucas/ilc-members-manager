/* resources.spec.ts
 *
 * Unit tests for ResourcesComponent. Verifies the component can be
 * created and that core file management interactions work, including
 * access level selection.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResourcesComponent } from './resources';
import {
  ResourceAccessLevel,
  RESOURCE_ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
} from '../../../../functions/src/data-model';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP } from '../../app.config';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('ResourcesComponent', () => {
  let component: ResourcesComponent;
  let fixture: ComponentFixture<ResourcesComponent>;

  const mockDataManager = {
    listResources: vi.fn().mockResolvedValue([]),
    deleteResource: vi.fn().mockResolvedValue(undefined),
  } as never as DataManagerService;

  const mockFirebaseApp = {} as never;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResourcesComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: FIREBASE_APP, useValue: mockFirebaseApp },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResourcesComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should format file sizes correctly', () => {
    expect(component.formatSize('0')).toBe('0 B');
    expect(component.formatSize('1024')).toBe('1.0 KB');
    expect(component.formatSize('1048576')).toBe('1.0 MB');
    expect(component.formatSize('500')).toBe('500 B');
  });

  it('should return correct file type class', () => {
    expect(component.fileTypeClass('application/pdf')).toBe('file-pdf');
    expect(component.fileTypeClass('image/png')).toBe('file-image');
    expect(component.fileTypeClass('video/mp4')).toBe('file-video');
    expect(component.fileTypeClass('application/octet-stream')).toBe('file-generic');
  });

  it('should default to members access level', () => {
    expect(component.selectedAccessLevel()).toBe(ResourceAccessLevel.Members);
  });

  it('should return correct access label for known levels', () => {
    expect(component.accessLabel('public')).toBe('Public');
    expect(component.accessLabel('members')).toBe('Members');
    expect(component.accessLabel('instructors')).toBe('Instructors');
    expect(component.accessLabel('school-owners')).toBe('School Owners');
    expect(component.accessLabel('admins')).toBe('Admins');
  });

  it('should fall back to raw string for unknown access level', () => {
    expect(component.accessLabel('unknown-level')).toBe('unknown-level');
  });

  it('should return correct access level CSS class', () => {
    expect(component.accessLevelClass('public')).toBe('access-public');
    expect(component.accessLevelClass('admins')).toBe('access-admins');
    expect(component.accessLevelClass('bogus')).toBe('access-unknown');
  });

  it('should have all access levels with labels', () => {
    for (const level of RESOURCE_ACCESS_LEVELS) {
      expect(ACCESS_LEVEL_LABELS[level]).toBeTruthy();
    }
  });
});
