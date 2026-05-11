import { Directive, TemplateRef } from '@angular/core';
import { WhitecapFileItem } from './models';

export interface WcfmTileItemContext {
  $implicit: WhitecapFileItem;
  selected: boolean;
}

@Directive({ selector: '[wcfmTileItem]', standalone: true })
export class WcfmTileItemDirective {
  constructor(public readonly templateRef: TemplateRef<WcfmTileItemContext>) {}

  static ngTemplateContextGuard(
    _dir: WcfmTileItemDirective,
    ctx: unknown,
  ): ctx is WcfmTileItemContext {
    return true;
  }
}
