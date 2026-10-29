import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export const COMPLAINT_CATEGORIES = ['QUALITY', 'PRICE', 'NO_SHOW', 'DAMAGE', 'PAYMENT', 'BEHAVIOUR', 'OTHER'] as const;

export class CreateComplaintDto {
  @ApiPropertyOptional({ description: 'Mission concernée (facultatif pour une question générale)' }) @IsOptional() @IsUUID() missionId?: string;
  @ApiProperty({ enum: COMPLAINT_CATEGORIES }) @IsIn(COMPLAINT_CATEGORIES) category!: (typeof COMPLAINT_CATEGORIES)[number];
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 4000) description!: string;
  @ApiPropertyOptional({ type: [String], description: 'Pièces jointes (fichiers COMPLAINT_ATTACHMENT finalisés)' })
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) fileIds?: string[];
}

export class ComplaintMessageDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 4000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fileId?: string;
}

export class SupportMessageDto extends ComplaintMessageDto {
  @ApiPropertyOptional({ description: 'Note interne au support, invisible de l’utilisateur' }) @IsOptional() @IsBoolean() internal?: boolean;
}

export class ComplaintStatusDto {
  @ApiProperty({ enum: ['IN_REVIEW', 'WAITING_USER', 'RESOLVED', 'REJECTED'] }) @IsIn(['IN_REVIEW', 'WAITING_USER', 'RESOLVED', 'REJECTED']) status!: 'IN_REVIEW' | 'WAITING_USER' | 'RESOLVED' | 'REJECTED';
  @ApiPropertyOptional({ description: 'Décision, obligatoire pour clore' }) @IsOptional() @Transform(trim) @IsString() @Length(5, 2000) resolution?: string;
  @ApiPropertyOptional({ description: 'Remboursement accordé (créé par un rôle habilité)' }) @IsOptional() @IsUUID() refundId?: string;
}

export class AdminComplaintsQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_REVIEW', 'WAITING_USER', 'RESOLVED', 'REJECTED'] }) @IsOptional() @IsIn(['OPEN', 'IN_REVIEW', 'WAITING_USER', 'RESOLVED', 'REJECTED']) status?: 'OPEN' | 'IN_REVIEW' | 'WAITING_USER' | 'RESOLVED' | 'REJECTED';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}
