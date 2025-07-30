import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Eigenwatch Risk and Profiling API')
    .setDescription('API for assessing risks and profiles of operators and AVS')
    .setVersion('0.1')
    .build();
  const documentFactory = () =>
    SwaggerModule.createDocument(app, config, { deepScanRoutes: true });
  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(process.env.PORT ?? 8000);
}
bootstrap();
