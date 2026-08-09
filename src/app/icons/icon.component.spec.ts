import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';
import { describe, it, expect, beforeEach } from 'vitest';

describe('IconComponent', () => {
  let fixture: ComponentFixture<IconComponent>;
  let component: IconComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IconComponent);
    component = fixture.componentInstance;
  });

  it('should default to currentColor for standard icons so they match text color', () => {
    fixture.componentRef.setInput('name', 'home');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg.getAttribute('fill')).toBe('currentColor');
  });

  it('should use explicitly provided fill input when supplied', () => {
    fixture.componentRef.setInput('name', 'home');
    fixture.componentRef.setInput('fill', 'white');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg.getAttribute('fill')).toBe('white');
  });

  it('should support error icon with default red fill when not overridden', () => {
    fixture.componentRef.setInput('name', 'error');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg.getAttribute('fill')).toBe('#d32f2f');
  });
});
