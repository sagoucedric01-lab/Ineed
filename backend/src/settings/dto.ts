import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateDispatchRuleDto {
  @ApiPropertyOptional({ description: 'Rayon de recherche initial (m)' }) @IsOptional() @IsInt() @Min(500) @Max(100_000) initialRadiusM?: number;
  @ApiPropertyOptional({ description: 'Élargissement à chaque vague (m)' }) @IsOptional() @IsInt() @Min(100) @Max(50_000) radiusStepM?: number;
  @ApiPropertyOptional({ description: 'Rayon maximal (m)' }) @IsOptional() @IsInt() @Min(500) @Max(100_000) maxRadiusM?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(50) prosPerWave?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(15) @Max(86_400) waveIntervalS?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(15) @Max(86_400) offerTtlS?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(86_400) reservationTtlS?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(86_400) clientConfirmTtlS?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(20) maxOffersShown?: number;
}

export class UpdateSettingDto {
  @ApiProperty({ description: 'Nouvelle valeur, du même type que la valeur actuelle' }) @IsDefined() value!: unknown;
}
