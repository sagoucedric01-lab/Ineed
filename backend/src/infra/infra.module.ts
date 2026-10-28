import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [PrismaService, RedisService, StorageService],
  exports: [PrismaService, RedisService, StorageService],
})
export class InfraModule {}
