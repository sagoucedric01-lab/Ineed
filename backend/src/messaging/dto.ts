import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class OpenConversationDto {
  @ApiProperty() @IsUUID() requestId!: string;
  @ApiPropertyOptional({ description: 'Professionnel (obligatoire pour le client)' }) @IsOptional() @IsUUID() proId?: string;
}

export class SendMessageDto {
  @ApiProperty({ description: 'Identifiant généré par l’application : un renvoi après coupure ne crée pas de doublon' })
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) clientMsgId!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) body?: string;
  @ApiPropertyOptional({ description: 'Photo (fichier MESSAGE_PHOTO finalisé)' }) @IsOptional() @IsUUID() fileId?: string;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({ description: 'Messages antérieurs à cette date (pagination)' }) @IsOptional() @IsDateString() before?: string;
}

export class ReportDto {
  @ApiProperty({ enum: ['USER', 'PRO_PROFILE', 'MESSAGE', 'REVIEW', 'REQUEST'] }) @IsIn(['USER', 'PRO_PROFILE', 'MESSAGE', 'REVIEW', 'REQUEST']) targetType!: 'USER' | 'PRO_PROFILE' | 'MESSAGE' | 'REVIEW' | 'REQUEST';
  @ApiProperty() @IsUUID() targetId!: string;
  @ApiProperty({ enum: ['SPAM', 'HARASSMENT', 'FRAUD', 'OFF_PLATFORM_PAYMENT', 'INAPPROPRIATE', 'OTHER'] })
  @IsIn(['SPAM', 'HARASSMENT', 'FRAUD', 'OFF_PLATFORM_PAYMENT', 'INAPPROPRIATE', 'OTHER']) reason!: 'SPAM' | 'HARASSMENT' | 'FRAUD' | 'OFF_PLATFORM_PAYMENT' | 'INAPPROPRIATE' | 'OTHER';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 1000) details?: string;
}
