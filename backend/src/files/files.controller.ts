import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators.js';
import { CreateUploadDto, FileDto, UploadTicketDto } from './dto.js';
import { FilesService } from './files.service.js';

@ApiTags('Fichiers')
@ApiBearerAuth()
@Controller('v1/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @ApiOperation({ summary: 'Prépare l’envoi d’un fichier (URL présignée valable 10 min)' })
  @ApiResponse({ status: 201, type: UploadTicketDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUploadDto): Promise<UploadTicketDto> {
    return this.files.createUpload(user.userId, dto.purpose, dto.mimeType, dto.sizeBytes);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finalise l’envoi : contrôle du type réel et de la taille, ré-encodage des images' })
  @ApiResponse({ status: 200, type: FileDto })
  async complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<FileDto> {
    const f = await this.files.complete(user.userId, id);
    return { id: f.id, status: f.status, mimeType: f.mimeType, sizeBytes: Number(f.sizeBytes) };
  }
}
