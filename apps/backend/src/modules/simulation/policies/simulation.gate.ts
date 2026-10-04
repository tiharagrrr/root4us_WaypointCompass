import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../../config/app-config';
import { NotFoundError } from '../../../core/errors/domain-errors';
import { LLM_PROVIDER, type LlmProvider } from '../../../core/providers/ports';
import { SettingsService } from '../../../core/settings/settings.service';

/**
 * The two switches. The simulator exists only with DEMO_MODE and
 * SIMULATION_ENABLED both true; otherwise its endpoints answer 404, as the
 * demo tools do. The AI director needs a configured model (LLM_PROVIDER is
 * not `disabled`) and the simulation.aiDirector setting an admin turns on.
 */
@Injectable()
export class SimulationGate {
  constructor(
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider | null,
  ) {}

  get enabled(): boolean {
    return this.config.demo.enabled && this.config.simulation.enabled;
  }

  assertEnabled(): void {
    if (!this.enabled) throw new NotFoundError('simulation');
  }

  /** The model, or null when none is configured. */
  get model(): LlmProvider | null {
    return this.config.llm.provider === 'disabled' ? null : this.llm;
  }

  async directorOn(): Promise<boolean> {
    return (
      this.model !== null && (await this.settings.get('simulation.aiDirector'))
    );
  }
}
