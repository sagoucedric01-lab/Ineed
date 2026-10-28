import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../geo/dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class PlaceInputDto {
  @ApiProperty({ type: LatLngDto }) @ValidateNested() @Type(() => LatLngDto) location!: LatLngDto;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() zoneId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) street?: string;
  @ApiPropertyOptional({ example: 'Face à l’école primaire, maison au portail vert' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) landmark?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) instructions?: string;
}

export class WindowDto {
  @ApiProperty({ format: 'date-time' }) @IsDateString() start!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() end!: string;
}

export class RequestInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Prestation précise (sous-catégorie), si le client l’a choisie' }) @IsOptional() @IsUUID() serviceId?: string;
  @ApiProperty({ enum: ['URGENT', 'SCHEDULED'] }) @IsIn(['URGENT', 'SCHEDULED']) mode!: 'URGENT' | 'SCHEDULED';
  @ApiProperty({ minLength: 10, maxLength: 2000, example: 'L’eau fuit sous l’évier de la cuisine depuis ce matin.' })
  @Transform(trim) @IsString() @Length(10, 2000, { message: 'Décrivez le problème en 10 caractères au moins.' }) description!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Adresse enregistrée (sinon, indiquer « place »)' }) @IsOptional() @IsUUID() addressId?: string;
  @ApiPropertyOptional({ type: PlaceInputDto }) @IsOptional() @ValidateNested() @Type(() => PlaceInputDto) place?: PlaceInputDto;
  @ApiPropertyOptional({ type: WindowDto, description: 'Créneau souhaité (obligatoire pour publier une demande programmée)' })
  @IsOptional() @ValidateNested() @Type(() => WindowDto) window?: WindowDto;
  @ApiPropertyOptional({ description: 'Budget indicatif en F CFA (entier)' }) @IsOptional() @IsInt() @Min(500) @Max(10_000_000) budgetXof?: number;
  @ApiPropertyOptional({ type: [String], description: 'Photos (fichiers REQUEST_PHOTO finalisés)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) photoFileIds?: string[];
  @ApiPropertyOptional({ format: 'uuid', description: 'Note vocale (fichier REQUEST_VOICE finalisé)' }) @IsOptional() @IsUUID() voiceFileId?: string;
}

export class CancelRequestDto {
  @ApiPropertyOptional({ example: 'Problème réglé entre-temps' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}

export class ListRequestsQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'history'], description: 'active : en cours ; history : terminées ou annulées' })
  @IsOptional() @IsIn(['active', 'history']) scope?: 'active' | 'history';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class AdminListRequestsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
