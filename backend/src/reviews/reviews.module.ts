import { Module } from '@nestjs/common';
import { ClientReviewsController, ProReviewsController, PublicReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({ controllers: [ClientReviewsController, PublicReviewsController, ProReviewsController], providers: [ReviewsService], exports: [ReviewsService] })
export class ReviewsModule {}
