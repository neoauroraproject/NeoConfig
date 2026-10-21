import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { PublicModule } from '../public/public.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [BrandsModule, PublicModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
