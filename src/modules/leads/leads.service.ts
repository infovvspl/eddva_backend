import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Lead } from '../../database/entities/lead.entity';
import { MailService } from '../mail/mail.service';
import { CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './dto/lead.dto';

@Injectable()
export class LeadsService implements OnModuleInit {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead, 'coaching')
    private readonly leadRepo: Repository<Lead>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** The coaching DataSource has synchronize off, so self-create the table. */
  async onModuleInit() {
    try {
      await this.leadRepo.query(`
        CREATE TABLE IF NOT EXISTS leads (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name varchar NOT NULL,
          email varchar NOT NULL,
          phone varchar,
          organization varchar,
          role varchar,
          vertical varchar,
          interested_feature varchar,
          message text,
          status varchar NOT NULL DEFAULT 'NEW',
          source varchar,
          notes text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz
        )
      `);
      await this.leadRepo.query(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
      await this.leadRepo.query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
    } catch (e: any) {
      this.logger.warn(`Could not ensure leads table exists: ${e?.message}`);
    }
  }

  /** The inbox that receives new-lead notifications (falls back to the mail "from"). */
  private get salesInbox(): string {
    return this.config.get<string>('LEADS_INBOX') || this.config.get<string>('mail.from') || '';
  }

  async create(dto: CreateLeadDto): Promise<Lead> {
    const lead = await this.leadRepo.save(this.leadRepo.create({ ...dto }));

    // Emails are best-effort — a mail failure must never fail the submission.
    const inbox = this.salesInbox;
    if (inbox) {
      this.mail
        .sendLeadNotification(inbox, {
          name: lead.name, email: lead.email, phone: lead.phone, organization: lead.organization,
          role: lead.role, vertical: lead.vertical, interestedFeature: lead.interestedFeature,
          message: lead.message, source: lead.source,
        })
        .catch((e) => this.logger.warn(`Lead notification email failed: ${e?.message}`));
    } else {
      this.logger.warn('No LEADS_INBOX / mail.from configured — skipping lead notification email');
    }
    this.mail
      .sendLeadConfirmation(lead.email, lead.name)
      .catch((e) => this.logger.warn(`Lead confirmation email failed: ${e?.message}`));

    return lead;
  }

  async list(q: ListLeadsQueryDto): Promise<{ items: Lead[]; total: number; page: number; limit: number }> {
    const page = q.page || 1;
    const limit = q.limit || 50;
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.vertical) where.vertical = q.vertical;

    const base = q.search
      ? [
          { ...where, name: ILike(`%${q.search}%`) },
          { ...where, email: ILike(`%${q.search}%`) },
          { ...where, organization: ILike(`%${q.search}%`) },
        ]
      : where;

    const [items, total] = await this.leadRepo.findAndCount({
      where: base,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async update(id: string, dto: UpdateLeadDto): Promise<Lead> {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (dto.status !== undefined) lead.status = dto.status;
    if (dto.notes !== undefined) lead.notes = dto.notes;
    return this.leadRepo.save(lead);
  }
}
