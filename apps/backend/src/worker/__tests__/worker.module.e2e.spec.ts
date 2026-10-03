import { Test } from '@nestjs/testing';
import { describeWithDb } from '../../../test/create-test-app';
import { AllocationProcessor } from '../allocation.processor';
import { OutboxProcessor } from '../outbox.processor';
import { WorkerModule } from '../worker.module';

/**
 * The worker's providers resolve: the API's tests never build WorkerModule,
 * so a processor whose dependencies are not reachable from it (the engine
 * runner lives in PlanningModule) would only fail when the worker starts.
 */
describeWithDb('worker module', () => {
  it('compiles with every processor and its dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    try {
      expect(moduleRef.get(AllocationProcessor)).toBeDefined();
      expect(moduleRef.get(OutboxProcessor)).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});
