import { Controller, Headers, type MessageEvent, Sse } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { Actor, AnyRole, ApiProblems } from '../../../core/http/decorators';
import { EventStreamService } from '../event-stream.service';

/** The one live feed per signed-in client (specs/realtime/spec.md). */
@ApiTags('streams')
@Controller('streams')
export class StreamsController {
  constructor(private readonly streams: EventStreamService) {}

  /** text/event-stream; channels come from the actor, never from the client. */
  @Sse('me')
  @AnyRole()
  @ApiProduces('text/event-stream')
  @ApiProblems(401)
  me(
    @Actor() actor: Actor,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.streams.stream(actor, lastEventId);
  }
}
