import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service.js';
import { AdminOnly } from '../auth/decorators.js';
import { AppError } from '../common/http/api-error.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { CreateCategoryDto, CreateServiceDto, CreateSkillDto, UpdateCategoryDto, UpdateServiceDto, UpdateSkillDto } from './dto.js';

const big = (v: number | null | undefined): bigint | null | undefined => (v === undefined ? undefined : v === null ? null : BigInt(v));
const num = (v: bigint | null): number | null => (v === null ? null : Number(v));

function duplicateSlug(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new AppError(409, 'SLUG_TAKEN', 'Cet identifiant est déjà utilisé.');
  }
  throw e;
}

interface Pricing {
  pricingModel: string;
  referenceMinXof: number | null;
  referenceMaxXof: number | null;
  fixedPriceXof: number | null;
}

function checkPricing(p: Pricing): void {
  if (p.pricingModel === 'FIXED' && p.fixedPriceXof === null) {
    throw new AppError(422, 'PRICING_INVALID', 'Une prestation à prix fixe doit indiquer son prix.');
  }
  if (p.referenceMinXof !== null && p.referenceMaxXof !== null && p.referenceMaxXof < p.referenceMinXof) {
    throw new AppError(422, 'PRICING_INVALID', 'Le prix de référence maximal doit être supérieur au minimal.');
  }
}

/** Module « Catalogue » : métiers, prestations (sous-catégories) et compétences. Rien n'est supprimé : on désactive. */
@ApiTags('Administration — catalogue')
@ApiBearerAuth()
@Controller('v1/admin/catalog')
export class AdminCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('categories')
  @AdminOnly('catalog.write')
  @ApiOperation({ summary: 'Tout le catalogue, éléments désactivés compris' })
  async list() {
    const rows = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { skills: { orderBy: { name: 'asc' } }, services: { orderBy: { name: 'asc' } } },
    });
    return rows.map((c) => ({
      id: c.id, slug: c.slug, name: c.name, description: c.description, searchTerms: c.searchTerms, iconKey: c.iconKey,
      sortOrder: c.sortOrder, isActive: c.isActive,
      skills: c.skills.map((s) => ({ id: s.id, name: s.name })),
      services: c.services.map((s) => ({
        id: s.id, slug: s.slug, name: s.name, description: s.description, pricingModel: s.pricingModel, isActive: s.isActive,
        referenceMinXof: num(s.referenceMinXof), referenceMaxXof: num(s.referenceMaxXof), fixedPriceXof: num(s.fixedPriceXof),
        defaultTravelFeeXof: num(s.defaultTravelFeeXof),
      })),
    }));
  }

  @Post('categories')
  @AdminOnly('catalog.write')
  async createCategory(@Body() dto: CreateCategoryDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.category
        .create({ data: { slug: dto.slug, name: dto.name, description: dto.description, searchTerms: dto.searchTerms ?? [], iconKey: dto.iconKey, sortOrder: dto.sortOrder ?? 0 } })
        .catch(duplicateSlug);
      await this.audit.record(auditContext(req), { action: 'catalog.category.create', entityType: 'category', entityId: c.id, after: dto }, tx);
      return { id: c.id };
    });
  }

  @Patch('categories/:id')
  @AdminOnly('catalog.write')
  @ApiOperation({ summary: 'Modifie ou désactive un métier (pris en compte immédiatement, sans redéploiement)' })
  async updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Ce métier n’existe pas.');
      await tx.category.update({ where: { id }, data: { ...dto, updatedAt: new Date() } });
      await this.audit.record(
        auditContext(req),
        { action: 'catalog.category.update', entityType: 'category', entityId: id, before: { name: before.name, isActive: before.isActive, searchTerms: before.searchTerms }, after: dto },
        tx,
      );
      return { id };
    });
  }

  @Post('services')
  @AdminOnly('catalog.write')
  async createService(@Body() dto: CreateServiceDto, @Req() req: AppRequest) {
    checkPricing({ pricingModel: dto.pricingModel, referenceMinXof: dto.referenceMinXof ?? null, referenceMaxXof: dto.referenceMaxXof ?? null, fixedPriceXof: dto.fixedPriceXof ?? null });
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({ where: { id: dto.categoryId, parentId: null } });
      if (!category) throw new AppError(422, 'CATEGORY_INVALID', 'Ce métier n’existe pas.');
      const s = await tx.service
        .create({
          data: {
            categoryId: dto.categoryId, slug: dto.slug, name: dto.name, description: dto.description, pricingModel: dto.pricingModel,
            referenceMinXof: big(dto.referenceMinXof), referenceMaxXof: big(dto.referenceMaxXof), fixedPriceXof: big(dto.fixedPriceXof),
            defaultTravelFeeXof: big(dto.defaultTravelFeeXof),
          },
        })
        .catch(duplicateSlug);
      await this.audit.record(auditContext(req), { action: 'catalog.service.create', entityType: 'service', entityId: s.id, after: dto }, tx);
      return { id: s.id };
    });
  }

  @Patch('services/:id')
  @AdminOnly('catalog.write')
  async updateService(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.service.findUnique({ where: { id } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Cette prestation n’existe pas.');
      const pick = (v: number | null | undefined, old: bigint | null) => (v === undefined ? num(old) : v);
      checkPricing({
        pricingModel: dto.pricingModel ?? before.pricingModel,
        referenceMinXof: pick(dto.referenceMinXof, before.referenceMinXof),
        referenceMaxXof: pick(dto.referenceMaxXof, before.referenceMaxXof),
        fixedPriceXof: pick(dto.fixedPriceXof, before.fixedPriceXof),
      });
      await tx.service.update({
        where: { id },
        data: {
          name: dto.name, description: dto.description, pricingModel: dto.pricingModel, isActive: dto.isActive,
          referenceMinXof: big(dto.referenceMinXof), referenceMaxXof: big(dto.referenceMaxXof), fixedPriceXof: big(dto.fixedPriceXof),
          defaultTravelFeeXof: big(dto.defaultTravelFeeXof),
        },
      });
      await this.audit.record(
        auditContext(req),
        { action: 'catalog.service.update', entityType: 'service', entityId: id, before: { name: before.name, isActive: before.isActive, pricingModel: before.pricingModel }, after: dto },
        tx,
      );
      return { id };
    });
  }

  @Post('skills')
  @AdminOnly('catalog.write')
  async createSkill(@Body() dto: CreateSkillDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({ where: { id: dto.categoryId, parentId: null } });
      if (!category) throw new AppError(422, 'CATEGORY_INVALID', 'Ce métier n’existe pas.');
      const s = await tx.skill.create({ data: { categoryId: dto.categoryId, name: dto.name } }).catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError(409, 'SKILL_EXISTS', 'Cette compétence existe déjà pour ce métier.');
        throw e;
      });
      await this.audit.record(auditContext(req), { action: 'catalog.skill.create', entityType: 'skill', entityId: s.id, after: dto }, tx);
      return { id: s.id };
    });
  }

  @Patch('skills/:id')
  @AdminOnly('catalog.write')
  async updateSkill(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSkillDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.skill.findUnique({ where: { id } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Cette compétence n’existe pas.');
      await tx.skill.update({ where: { id }, data: { name: dto.name } });
      await this.audit.record(auditContext(req), { action: 'catalog.skill.update', entityType: 'skill', entityId: id, before: { name: before.name }, after: dto }, tx);
      return { id };
    });
  }
}
