import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { LLM_PROVIDER, type LlmProvider } from './ports';
import { ScriptedLlmProvider } from './scripted-llm.provider';

/**
 * Picks each port's adapter from configuration. LLM_PROVIDER=disabled, the
 * default, resolves the token to null: no model exists to call.
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): LlmProvider | null => {
        const factories: Record<
          AppConfig['llm']['provider'],
          () => LlmProvider | null
        > = {
          disabled: () => null,
          scripted: () => new ScriptedLlmProvider(),
          anthropic: () => new AnthropicLlmProvider(config.llm),
        };
        return factories[config.llm.provider]();
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class ProvidersModule {}
