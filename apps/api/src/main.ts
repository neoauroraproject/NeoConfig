import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: false });
  // Renewal receipts arrive as base64 images.
  app.useBodyParser('json', { limit: '5mb' });
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  // Storefronts live on many custom domains and reach the API same-origin
  // through the proxy; CORS stays open for bearer-token (no cookie) calls.
  app.enableCors({ origin: true, credentials: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('NeoConfig API')
    .setDescription('White-label VPN subscription backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  await bootstrapAdmin(app.get(PrismaService));

  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`NeoConfig API listening on :${port}`);
}

async function bootstrapAdmin(prisma: PrismaService) {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    // Older installs may have an organization without a storefront.
    if (existing.orgId && !(await prisma.brand.count({ where: { orgId: existing.orgId } }))) {
      await prisma.brand.create({
        data: { orgId: existing.orgId, slug: 'default', appName: process.env.APP_NAME || 'NeoConfig', isDefault: true },
      });
    }
    return;
  }

  const org = await prisma.organization.create({
    data: {
      name: 'Default Organization',
      slug: 'default',
      brands: {
        create: { slug: 'default', appName: process.env.APP_NAME || 'NeoConfig', isDefault: true },
      },
      hmpanel: { create: { configured: false } },
    },
  });

  await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      name: 'Admin',
      role: Role.SUPER_ADMIN,
      orgId: org.id,
    },
  });
}

bootstrap();
