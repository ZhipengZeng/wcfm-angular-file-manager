import { Component, inject } from '@angular/core';
import { WhitecapFileManagerComponent, WhitecapUploadValidationConfig } from 'whitecap-file-manager';
import { ProductionLikeMockStorageProvider } from './production-like-mock-storage-provider';
import { MockStorageProvider } from './mock-storage-provider';

@Component({
  selector: 'app-root',
  imports: [WhitecapFileManagerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  /** Explorer shell height; any valid CSS length (demo uses viewport-relative cap). */
  protected readonly explorerHeight = 'min(42rem, 85vh)';

  protected readonly provider = inject(ProductionLikeMockStorageProvider);
  // protected readonly provider = inject(MockStorageProvider);
  protected readonly uploadValidation: WhitecapUploadValidationConfig = {
    maxFileSizeBytes: 5 * 1024 * 1024,
    acceptedExtensions: ['.md', '.txt', '.pdf', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.docx'],
  };
}
