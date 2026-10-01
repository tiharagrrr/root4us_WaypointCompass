// apps/backend/src/modules/ordering/ordering.module.ts · owner: Harini
// Store orders from draft to the 16:00 cutoff, templates and reorders.
// Spec: specs/ordering/spec.md. Tables: src/db/schema/ordering.ts.
import { Module } from '@nestjs/common';
import { OrderLinesController } from './controllers/order-lines.controller';
import { OrderTemplatesController } from './controllers/order-templates.controller';
import { OrdersController } from './controllers/orders.controller';

@Module({
  imports: [],
  // Contract first: these controllers hold the final routes and shapes and answer 501 until the
  // orders, lines and templates services land (specs/ordering/spec.md).
  controllers: [
    OrdersController,
    OrderLinesController,
    OrderTemplatesController,
  ],
  providers: [],
  exports: [],
})
export class OrderingModule {}
