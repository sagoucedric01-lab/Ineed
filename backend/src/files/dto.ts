import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { FILE_PURPOSES, type FilePurpose } from './file-rules.js';

export class CreateUploadDto {
  @ApiProperty({ enum: FILE_PURPOSES })
  @IsIn(FILE_PURPOSES)
  purpose!: FilePurpose;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ example: 245_760 })
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  sizeBytes!: number;
}

export class UploadTicketDto {
  @ApiProperty({ format: 'uuid' }) fileId!: string;
  @ApiProperty({ description: 'URL présignée : envoyer le contenu en PUT avec exactement les en-têtes indiqués.' }) uploadUrl!: string;
  @ApiProperty({ example: 'PUT' }) method!: 'PUT';
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) headers!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class FileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PENDING_UPLOAD', 'UPLOADED', 'READY', 'REJECTED', 'DELETED'] }) status!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() sizeBytes!: number;
}
