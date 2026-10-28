import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service.js';
import { AdminOnly } from '../auth/decorators.js';
import { AppError } from '../common/http/api-error.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { UpdateDispatchRuleDto, UpdateSettingDto } from './dto.js';
import { SettingsService } from './settings.service.js';

/** Paramètres et règles d'attribution, modifiables sans redéploiement. */
@ApiTags('Administration — paramètres')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get('settings')
  @AdminOnly('settings.write')
  list() {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' }, select: { key: true, value: true, description: true, updatedAt: true } });
  }

  @Put('settings/:key')
  @AdminOnly('settings.write')
  @ApiOperation({ summary: 'Modifie un paramètre existant (la valeur garde son type)' })
  async updateSetting(@Param('key') key: string, @Body() dto: UpdateSettingDto, @Req() req: AppRequest) {
    const before = await this.prisma.setting.findUnique({ where: { key } });
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Ce paramètre n’existe pas.');
    const typeOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    if (typeOf(before.value) !== typeOf(dto.value)) {
      throw new AppError(422, 'SETTING_TYPE_MISMATCH', 'La nouvelle valeur doit être du même type que l’actuelle.', { expected: typeOf(before.value) });
    }
    if (typeof dto.value === 'number' && (!Number.isFinite(dto.value) || dto.value < 0)) {
      throw new AppError(422, 'SETTING_INVALID', 'La valeur doit être un nombre positif.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.update({ where: { key }, data: { value: dto.value as Prisma.InputJsonValue, updatedBy: req.user?.userId, updatedAt: new Date() } });
      await this.audit.record(auditContext(req), { action: 'settings.update', entityType: 'setting', entityId: key, before: { key, value: before.value }, after: { key, value: dto.value } }, tx);
    });
    this.settings.invalidate(key);
    return { key, value: dto.value };
  }

  @Get('dispatch-rules')
  @AdminOnly('settings.write')
  @ApiOperation({ summary: 'Règles d’attribution (rayons de recherche, vagues, délais)' })
  dispatchRules() {
    return this.prisma.dispatchRule.findMany({ orderBy: [{ mode: 'asc' }, { updatedAt: 'desc' }] });
  }

  @Patch('dispatch-rules/:id')
  @AdminOnly('settings.write')
  @ApiOperation({ summary: 'Modifie une règle d’attribution (rayon initial, rayon maximal…)' })
  async updateDispatchRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDispatchRuleDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.dispatchRule.findUnique({ where: { id } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Cette règle n’existe pas.');
      const initial = dto.initialRadiusM ?? before.initialRadiusM;
      const max = dto.maxRadiusM ?? before.maxRadiusM;
      if (max < initial) throw new AppError(422, 'RULE_INVALID', 'Le rayon maximal doit être supérieur ou égal au rayon initial.');
      const after = await tx.dispatchRule.update({ where: { id }, data: { ...dto, updatedBy: req.user?.userId, updatedAt: new Date() } });
      await this.audit.record(auditContext(req), { action: 'dispatch_rule.update', entityType: 'dispatch_rule', entityId: id, before, after: dto }, tx);
      return after;
    });
  }
}
