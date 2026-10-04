import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { ClockService } from '../clock/clock.service';
import { DemoInbox } from '../demo/demo-inbox';
import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { DemoInboxSmsProvider } from './demo-inbox-sms.provider';
import { NotifyLkSmsProvider } from './notifylk-sms.provider';
import { OpenAiCompatibleLlmProvider } from './openai-llm.provider';
import {
  LLM_PROVIDER,
  SMS_PROVIDER,
  type LlmProvider,
  type SmsProvider,
} from './ports';
import { ScriptedLlmProvider } from './scripted-llm.provider';
import { TextLkSmsProvider } from './textlk-sms.provider';
import { TwilioSmsProvider } from './twilio-sms.provider';

/**
 * Picks each port's adapter from configuration. LLM_PROVIDER=disabled, the
 * default, resolves the token to null: no model exists to call. SMS always
 * resolves to something, because sign-in codes must have somewhere to go;
 * SMS_PROVIDER=demo-inbox, the default, keeps them on this machine.
 */
@Module({
  providers: [
    DemoInbox,
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
          'openai-compatible': () =>
            new OpenAiCompatibleLlmProvider(config.llm.openai),
        };
        return factories[config.llm.provider]();
      },
    },
    {
      provide: SMS_PROVIDER,
      inject: [AppConfig, DemoInbox, ClockService],
      useFactory: (
        config: AppConfig,
        inbox: DemoInbox,
        clock: ClockService,
      ): SmsProvider => {
        const sms = config.sms;
        const factories: Record<typeof sms.provider, () => SmsProvider> = {
          'demo-inbox': () => new DemoInboxSmsProvider(inbox, clock),
          notifylk: () => new NotifyLkSmsProvider(sms.notifylk),
          textlk: () => new TextLkSmsProvider(sms.textlk),
          twilio: () => new TwilioSmsProvider(sms.twilio),
        };
        return factories[sms.provider]();
      },
    },
  ],
  exports: [LLM_PROVIDER, SMS_PROVIDER],
})
export class ProvidersModule {}
