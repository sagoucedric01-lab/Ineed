import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Jeton d’enregistrement Firebase Cloud Messaging de l’appareil' }) @Transform(trim) @IsString() @Length(20, 4096) pushToken!: string;
  @ApiProperty({ enum: ['ANDROID', 'IOS'] }) @IsIn(['ANDROID', 'IOS']) platform!: 'ANDROID' | 'IOS';
  @ApiPropertyOptional({ example: '0.4.0' }) @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 500) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
