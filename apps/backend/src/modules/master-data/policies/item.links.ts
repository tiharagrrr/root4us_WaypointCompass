import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { ItemDto } from '../dto/item.dto';
import type { ItemRow } from '../services/item.queries';

/** A catalog item on M1a and M9. Only an admin sees the edit link. */
@Injectable()
export class ItemLinks extends LinkBuilder<ItemRow, Omit<ItemDto, '_links'>> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(i: ItemRow) {
    return `/api/v1/items/${i.id}`;
  }

  protected actions(i: ItemRow, actor: Actor): LinkMap {
    return {
      edit: can(actor, 'catalog:manage') && {
        href: this.self(i),
        method: 'PATCH',
        title: 'Edit item',
      },
    };
  }

  protected present(i: ItemRow): Omit<ItemDto, '_links'> {
    return {
      id: i.id,
      sku: i.sku,
      name: i.name,
      brand: i.brand,
      category: i.category,
      tempClass: i.tempClass,
      packLabel: i.packLabel,
      unitWeightKg: i.unitWeightKg,
      unitVolumeM3: i.unitVolumeM3,
      unitValueLkr: i.unitValueLkr,
      fragile: i.fragile,
      active: i.active,
    };
  }
}
