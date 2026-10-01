import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { Actor } from '../../../core/http/decorators';
import type { Database } from '../../../db/client';
import { DB } from '../../../db/database.module';
import { users } from '../../../db/schema';
import type { UpdateMeDto } from '../dto/me.dto';

/** The columns /me may show: never pinHash or the password account. */
const PROFILE = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  phoneNumber: users.phoneNumber,
  role: users.role,
  depotId: users.depotId,
  outletId: users.outletId,
  vehicleId: users.defaultVehicleId,
  locale: users.locale,
};

export interface ProfileRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  phoneNumber: string | null;
  role: string;
  depotId: string | null;
  outletId: string | null;
  vehicleId: string | null;
  locale: string;
}

/**
 * The caller's own profile (D12). Reads go to the users row, not the session,
 * so a scope change shows at once even while the session cookie is cached.
 */
@Injectable()
export class MeService {
  private readonly log = new Logger(MeService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async get(actor: Actor): Promise<ProfileRow> {
    const [row] = await this.db
      .select(PROFILE)
      .from(users)
      .where(eq(users.id, actor.id));
    if (!row) throw new NotFoundError('user');
    return row;
  }

  /**
   * Only the caller's preferences change here. TODO(ROO-7, audit): run under
   * @Transactional() with audit.record once AuditService exists.
   */
  async update(actor: Actor, dto: UpdateMeDto): Promise<ProfileRow> {
    if (dto.locale === undefined) return this.get(actor);
    const [row] = await this.db
      .update(users)
      .set({ locale: dto.locale })
      .where(eq(users.id, actor.id))
      .returning(PROFILE);
    if (!row) throw new NotFoundError('user');
    this.log.log(
      { event: 'identity.user.locale_changed', userId: actor.id },
      'locale changed',
    );
    return row;
  }
}
