import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: false });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.APP_URL || true,
    credentials: true,
  });
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
  if (existing) return;

  const org = await prisma.organization.create({
    data: {
      name: 'Default Organization',
      slug: 'default',
      branding: { create: { appName: process.env.APP_NAME || 'NeoConfig' } },
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
