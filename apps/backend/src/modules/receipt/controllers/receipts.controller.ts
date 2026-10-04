import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Response } from 'express';
import {
  Actor,
  ApiProblems,
  ApiResource,
  IfMatch,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { ConfirmReceiptDto, ReceiptDto } from '../dto/receipt.dto';
import { ReceiptLinks } from '../policies/receipt.links';
import { ReceiptQueries } from '../services/receipt.queries';
import { ReceiptService } from '../services/receipt.service';

/**
 * M5: one order's receipt. The order is the resource, so there is no receipt id in the
 * path. Confirming sends the order's version in `If-Match` (it rides the ETag of the GET)
 * and an `Idempotency-Key`; a retry returns the stored answer.
 */
@ApiTags('receipt')
@Controller('orders')
export class ReceiptsController {
  constructor(
    private readonly queries: ReceiptQueries,
    private readonly receipts: ReceiptService,
    private readonly links: ReceiptLinks,
  ) {}

  @Get(':id/receipt')
  @RequirePermission('receipt:read')
  @ApiResource(ReceiptDto)
  @ApiOperation({
    summary: "An order's receipt",
    description:
      'Expected against delivered lines, the proof of delivery and whether the store can still confirm.',
  })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.forOrder(id, actor), actor);
  }

  @Post(':id/receipt')
  @RequirePermission('receipt:confirm')
  @UseIdempotency()
  @ApiResource(ReceiptDto, { status: 201 })
  @ApiProblems(400, 409)
  @ApiOperation({
    summary: 'Confirm the receipt',
    description:
      'Compares what arrived with what the driver delivered and opens an issue for each line that is wrong. Before the driver’s record syncs, a confirmation after the ETA is kept as awaitingDriverSync.',
  })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReceiptDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const receipt = await this.receipts.confirm(id, dto, actor, version);
    res.location(`/api/v1/orders/${id}/receipt`);
    return this.links.one(receipt, actor);
  }
}
