import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import {
  contains,
  type ResourceSpec,
} from '../../../core/persistence/resource-spec';
import { invitations } from '../../../db/schema';
import { InvitationScope } from '../policies/admin.scope';
import { ScopeDirectory, type ScopeNames } from './scope-directory';

export type InvitationRow = typeof invitations.$inferSelect;

/** An invitation with the names behind its scope ids. */
export type NamedInvitation = InvitationRow & { scopeNames: ScopeNames };

/**
 * Invitations as a resource (A1). No status filter yet: a PENDING row past
 * expiresAt is EXPIRED (domain/invitation.ts), so filtering the status column
 * alone would list expired invitations as pending.
 */
export const INVITATIONS = {
  name: 'invitations',
  table: invitations,
  queryKey: 'invitations',
  pagination: 'offset',
  defaultSort: '-createdAt',
  filters: {},
  sorts: {
    createdAt: invitations.createdAt,
    expiresAt: invitations.expiresAt,
    name: invitations.name,
  },
  search: (q) =>
    or(
      ilike(invitations.name, contains(q)),
      ilike(invitations.email, contains(q)),
      ilike(invitations.phoneNumber, contains(q)),
    ),
} satisfies ResourceSpec<typeof invitations>;

@Injectable()
export class InvitationQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly scope: InvitationScope,
    private readonly directory: ScopeDirectory,
  ) {}

  async list(query: ListQuery, actor: Actor): Promise<Page<NamedInvitation>> {
    const page = await this.crud.list<InvitationRow>(
      INVITATIONS,
      query,
      this.scope.where(actor),
    );
    return { ...page, items: await this.named(page.items) };
  }

  async get(id: string, actor: Actor): Promise<NamedInvitation> {
    const row = await this.crud.get<InvitationRow>(
      INVITATIONS,
      id,
      this.scope.where(actor),
    );
    return (await this.named([row]))[0];
  }

  async named(rows: InvitationRow[]): Promise<NamedInvitation[]> {
    const names = await this.directory.names(rows);
    return rows.map((i, n) => ({ ...i, scopeNames: names[n] }));
  }
}
