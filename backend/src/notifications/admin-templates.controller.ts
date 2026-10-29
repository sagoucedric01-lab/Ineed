import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { AdminOnly, CurrentUser } from '../auth/decorators.js';
import { AppError } from '../common/http/api-error.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma.service.js';
import { UpdateTemplateDto } from './dto.js';

const vars = (s: string) => new Set([...s.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!));

@ApiTags('Administration — notifications')
@ApiBearerAuth()
@Controller('v1/admin/notification-templates')
export class AdminTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AdminOnly('notification.write')
  async list() {
    const rows = await this.prisma.notificationTemplate.findMany({ where: { channel: 'PUSH', locale: 'fr-CI' }, orderBy: { type: 'asc' } });
    return rows.map((t) => ({ type: t.type, title: t.title, body: t.body, isActive: t.isActive, variables: [...vars(`${t.title} ${t.body}`)], updatedAt: t.updatedAt.toISOString() }));
  }

  @Put(':type')
  @AdminOnly('notification.write')
  @ApiOperation({ summary: 'Modifier le texte d’une notification (mêmes variables que le gabarit d’origine) ou la désactiver' })
  async update(@CurrentUser() user: AuthUser, @Req() req: AppRequest, @Param('type') type: string, @Body() dto: UpdateTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.notificationTemplate.findUnique({ where: { type_channel_locale: { type, channel: 'PUSH', locale: 'fr-CI' } } });
      if (!t) throw new AppError(404, 'NOT_FOUND', 'Ce gabarit n’existe pas.');
      const allowed = vars(`${t.title} ${t.body}`);
      const unknown = [...vars(`${dto.title ?? ''} ${dto.body ?? ''}`)].filter((v) => !allowed.has(v));
      if (unknown.length) throw new AppError(422, 'TEMPLATE_UNKNOWN_VARIABLE', `Variable inconnue pour ce gabarit : ${unknown.map((v) => `{{${v}}}`).join(', ')}.`, { allowed: [...allowed] });
      const updated = await tx.notificationTemplate.update({
        where: { type_channel_locale: { type, channel: 'PUSH', locale: 'fr-CI' } },
        data: { title: dto.title ?? t.title, body: dto.body ?? t.body, isActive: dto.isActive ?? t.isActive, updatedBy: user.userId, updatedAt: new Date() },
      });
      await this.audit.record({ ...auditContext(req), actorId: user.userId }, { action: 'notification_template.update', entityType: 'notification_template', entityId: type, before: { title: t.title, body: t.body, isActive: t.isActive }, after: { title: updated.title, body: updated.body, isActive: updated.isActive } }, tx);
      return { type: updated.type, title: updated.title, body: updated.body, isActive: updated.isActive };
    });
  }
}
