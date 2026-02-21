import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../../data-manager.service';
import { SpinnerComponent } from '../../spinner/spinner.component';

@Component({
  selector: 'app-country-codes',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent],
  templateUrl: './country-codes.html',
  styleUrl: './country-codes.scss',
})
export class CountryCodes implements OnInit {
  dataManager = inject(DataManagerService);

  staticDocs = signal<{ id: string, data: any, raw: string }[]>([]);
  isLoadingStatic = signal(false);
  isSavingStatic = signal<Record<string, boolean>>({});
  staticMessages = signal<Record<string, string>>({});

  ngOnInit() {
    this.loadStaticDocs();
  }

  async loadStaticDocs() {
    this.isLoadingStatic.set(true);
    try {
      const docs = await this.dataManager.getStaticDocs();
      // Only keep the country codes if requested, or keep all static docs? 
      // User said "one for country codes".
      this.staticDocs.set(docs.map(d => ({ ...d, raw: JSON.stringify(d.data, null, 2) })));
    } catch (err) {
      console.error(err);
    } finally {
      this.isLoadingStatic.set(false);
    }
  }

  async saveStaticDoc(docObj: { id: string, data: any, raw: string }) {
    this.isSavingStatic.update(m => ({ ...m, [docObj.id]: true }));
    this.staticMessages.update(m => ({ ...m, [docObj.id]: '' }));
    try {
      const parsed = JSON.parse(docObj.raw);
      await this.dataManager.saveStaticDoc(docObj.id, parsed);
      this.staticMessages.update(m => ({ ...m, [docObj.id]: 'Saved successfully.' }));
    } catch (err: any) {
      this.staticMessages.update(m => ({ ...m, [docObj.id]: `Error: ${err.message}` }));
    } finally {
      this.isSavingStatic.update(m => ({ ...m, [docObj.id]: false }));
    }
  }
}
