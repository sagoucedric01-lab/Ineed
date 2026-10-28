import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { HealthService, type ReadinessReport } from './health.service.js';

@ApiTags('Santé')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Le processus répond : utilisé par l'orchestrateur pour redémarrer un conteneur bloqué. */
  @Get('live')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Le processus est vivant.' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Les dépendances répondent : l'instance peut recevoir du trafic. */
  @Get('ready')
  @ApiOkResponse({ description: 'Base de données, Redis et stockage disponibles.' })
  @ApiServiceUnavailableResponse({ description: 'Au moins une dépendance est indisponible.' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    res.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
