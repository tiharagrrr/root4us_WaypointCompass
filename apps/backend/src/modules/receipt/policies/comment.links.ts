import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { CommentDto } from '../dto/issue.dto';
import type { CommentRow } from '../services/issue-thread.service';

/** A comment on an issue's thread. There is nothing to do with one: no editing, no deleting. */
@Injectable()
export class CommentLinks extends LinkBuilder<CommentRow, CommentDto> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(c: CommentRow) {
    return `/api/v1/issues/${c.entityId}/comments`;
  }

  protected actions(c: CommentRow): LinkMap {
    return { issue: { href: `/api/v1/issues/${c.entityId}` } };
  }

  protected present(c: CommentRow): CommentDto {
    return {
      id: c.id,
      issueId: c.entityId,
      authorId: c.authorId,
      authorRole: c.authorRole,
      authorName: c.authorName,
      body: c.body,
      createdAt: this.clock.toIso(c.createdAt),
      _links: {},
    };
  }
}
