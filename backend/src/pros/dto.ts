import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString,
  IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WeeklyHourDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: '1 = lundi … 7 = dimanche' }) @IsInt() @Min(1) @Max(7) weekday!: number;
  @ApiProperty({ example: '08:00' }) @Matches(HHMM) start!: string;
  @ApiProperty({ example: '18:00' }) @Matches(HHMM) end!: string;
}

export class GeoPointDto {
  @ApiProperty({ example: 5.37 }) @IsLatitude() lat!: number;
  @ApiProperty({ example: -3.985 }) @IsLongitude() lng!: number;
}

export class SaveProProfileDto {
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'] }) @IsIn(['INDIVIDUAL', 'COMPANY']) kind!: 'INDIVIDUAL' | 'COMPANY';
  @ApiProperty({ example: 'Koffi Plomberie' }) @IsString() @Length(2, 80) businessName!: string;
  @ApiPropertyOptional({ example: 'CI-ABJ-2024-B-12345' }) @IsOptional() @IsString() @MaxLength(40) companyRegNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(800) bio?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(70) yearsExperience?: number;
  @ApiProperty({ type: [String], description: '1 à 3 métiers' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsUUID('all', { each: true }) categoryIds!: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) skillIds?: string[];
  @ApiProperty({ type: [String], description: 'Communes desservies' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) zoneIds!: string[];
  @ApiPropertyOptional({ minimum: 500, maximum: 100000 }) @IsOptional() @IsInt() @Min(500) @Max(100_000) serviceRadiusM?: number;
  @ApiPropertyOptional({ type: GeoPointDto }) @IsOptional() @ValidateNested() @Type(() => GeoPointDto) baseLocation?: GeoPointDto;
  @ApiProperty({ type: [WeeklyHourDto] }) @IsArray() @ArrayMaxSize(21) @ValidateNested({ each: true }) @Type(() => WeeklyHourDto) weeklyHours!: WeeklyHourDto[];
}

export class AddDocumentDto {
  @ApiProperty({ example: 'PIECE_IDENTITE' }) @IsString() @Length(2, 40) typeCode!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() fileId!: string;
}

export class AvailabilityDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isOnline?: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String, description: 'null pour reprendre immédiatement' })
  @IsOptional() @IsDateString() pausedUntil?: string | null;
}

export class DecisionDto {
  @ApiPropertyOptional({ description: 'Obligatoire pour refuser, demander des compléments ou suspendre ; communiqué au professionnel.' })
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [String], description: 'Documents à refuser (demande de compléments)' })
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) rejectedDocumentIds?: string[];
}

export class ListProsQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'] })
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'])
  status?: 'DRAFT' | 'SUBMITTED' | 'INFO_REQUESTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
