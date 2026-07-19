import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailTemplatesComponent } from './email-templates';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { initEmailTemplates } from '../../../../functions/src/data-model';

describe('EmailTemplatesComponent', () => {
  let component: EmailTemplatesComponent;
  let fixture: ComponentFixture<EmailTemplatesComponent>;
  let mockDataManager: any;

  beforeEach(async () => {
    mockDataManager = {
      emailTemplates: signal(initEmailTemplates()),
      saveEmailTemplates: vi.fn().mockResolvedValue({}),
    };

    await TestBed.configureTestingModule({
      imports: [EmailTemplatesComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EmailTemplatesComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display the subjects and bodies of templates', () => {
    const el = fixture.nativeElement;
    const inputs = el.querySelectorAll('input');
    const textareas = el.querySelectorAll('textarea');

    expect(inputs[0].value).toBe('Welcome to the I Liq Chuan Family!');
    expect(textareas[0].value).toContain('Welcome to the I Liq Chuan family!');
    expect(inputs[1].value).toBe('Congratulations on your Instructor License!');
    expect(textareas[1].value).toContain('Congratulations on getting your Instructor ID');
  });

  it('should call saveEmailTemplates when clicking Save Templates button', async () => {
    const el = fixture.nativeElement;
    const btn = el.querySelector('button.btn-primary');
    btn.click();
    expect(mockDataManager.saveEmailTemplates).toHaveBeenCalled();
  });
});
