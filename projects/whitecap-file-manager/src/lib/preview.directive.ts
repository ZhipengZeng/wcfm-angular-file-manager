import { Directive, TemplateRef } from '@angular/core';
import { WhitecapFileItem } from './models';

export interface WcfmPreviewContext {
  /** The selected file item to preview. */
  $implicit: WhitecapFileItem;
  /** True while the built-in provider.preview() call is in-flight. */
  loading: boolean;
}

@Directive({ selector: '[wcfmPreview]', standalone: true })
export class WcfmPreviewDirective {
  constructor(public readonly templateRef: TemplateRef<WcfmPreviewContext>) {}

  static ngTemplateContextGuard(
    _dir: WcfmPreviewDirective,
    ctx: unknown,
  ): ctx is WcfmPreviewContext {
    return true;
  }
}
