import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

export class UpdateMeDto {
  @ApiProperty({ example: 'Awa' })
  @IsString()
  @Length(1, 60)
  @Matches(NAME)
  firstName!: string;

  @ApiProperty({ example: 'Koné' })
  @IsString()
  @Length(1, 60)
  @Matches(NAME)
  lastName!: string;
}

export class SetAvatarDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fileId!: string;
}

export class ConfirmDeletionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ example: '481920' })
  @Matches(/^\d{6}$/)
  code!: string;
}

export class MeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) firstName!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'URL temporaire (1 h)' }) avatarUrl!: string | null;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty() profileComplete!: boolean;
  @ApiProperty({ nullable: true, type: String, enum: ['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'] }) proStatus!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid', description: 'Identifiant de l’appareil (famille de sessions)' }) id!: string;
  @ApiProperty({ enum: ['CLIENT', 'PRO', 'ADMIN'] }) app!: string;
  @ApiProperty({ nullable: true, type: String }) deviceLabel!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastUsedAt!: string;
  @ApiProperty({ description: 'Vrai pour l’appareil qui fait la requête' }) current!: boolean;
}
