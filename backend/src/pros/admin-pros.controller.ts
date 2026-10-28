import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/decorators.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import { AdminProsService } from './admin-pros.service.js';
import { DecisionDto, ListProsQueryDto } from './dto.js';

@ApiTags('Administration — professionnels')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminProsController {
  constructor(private readonly admin: AdminProsService) {}

  @Get('pros')
  @AdminOnly('pro.read')
  @ApiOperation({ summary: 'Dossiers professionnels (file d’attente par défaut : les plus anciens d’abord)' })
  list(@Query() q: ListProsQueryDto) {
    return this.admin.list(q.status, q.page ?? 1, q.pageSize ?? 20);
  }

  @Get('pros/:id')
  @AdminOnly('pro.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.detail(id);
  }

  @Get('documents/:id/url')
  @AdminOnly('document.read_private')
  @ApiOperation({ summary: 'URL de consultation d’un justificatif (60 s, consultation journalisée)' })
  documentUrl(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    return this.admin.documentUrl(id, auditContext(req));
  }

  @Post('pros/:id/approve')
  @HttpCode(200)
  @AdminOnly('pro.verify')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @Req() req: AppRequest) {
    return this.admin.decide(id, 'approve', auditContext(req), dto.note);
  }

  @Post('pros/:id/reject')
  @HttpCode(200)
  @AdminOnly('pro.verify')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @Req() req: AppRequest) {
    return this.admin.decide(id, 'reject', auditContext(req), dto.note);
  }

  @Post('pros/:id/request-info')
  @HttpCode(200)
  @AdminOnly('pro.verify')
  requestInfo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @Req() req: AppRequest) {
    return this.admin.decide(id, 'requestInfo', auditContext(req), dto.note, dto.rejectedDocumentIds ?? []);
  }

  @Post('pros/:id/suspend')
  @HttpCode(200)
  @AdminOnly('pro.suspend')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @Req() req: AppRequest) {
    return this.admin.decide(id, 'suspend', auditContext(req), dto.note);
  }

  @Post('pros/:id/reactivate')
  @HttpCode(200)
  @AdminOnly('pro.suspend')
  reactivate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @Req() req: AppRequest) {
    return this.admin.decide(id, 'reactivate', auditContext(req), dto.note);
  }
}
