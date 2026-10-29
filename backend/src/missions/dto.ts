import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class MissionReasonDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string;
}

export class RequiredReasonDto {
  @ApiProperty({ example: 'Le robinet fuit toujours' }) @Transform(trim) @IsString() @Length(5, 1000) reason!: string;
}

export class CompleteMissionDto {
  @ApiPropertyOptional({ description: 'Compte rendu : travaux réalisés, pièces changées, conseils' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) report?: string;
}

export class LocationPointDto {
  @ApiProperty() @IsLatitude() lat!: number;
  @ApiProperty() @IsLongitude() lng!: number;
  @ApiPropertyOptional({ description: 'Précision annoncée par le téléphone (m)' }) @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracyM?: number;
  @ApiProperty({ format: 'date-time', description: 'Horodatage du téléphone' }) @IsDateString() recordedAt!: string;
}

export class LocationBatchDto {
  @ApiProperty({ type: [LocationPointDto], description: 'Positions du trajet ; après une coupure, l’application envoie celles en attente' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => LocationPointDto) points!: LocationPointDto[];
}

export class ListMissionsQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'history'] }) @IsOptional() @IsIn(['active', 'history']) scope?: 'active' | 'history';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class AdminListMissionsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}
