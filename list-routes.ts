import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const server = app.getHttpServer();
  const router = server._events.request._router;

  const availableRoutes = [];
  router.stack.forEach((layer) => {
    if (layer.route) {
      availableRoutes.push({
        path: layer.route?.path,
        method: Object.keys(layer.route.methods)[0].toUpperCase(),
      });
    }
  });

  availableRoutes.forEach((route) => {
    if (route.path.includes('highlights') || route.path.includes('recordings')) {
      console.log(`${route.method} ${route.path}`);
    }
  });

  await app.close();
}
bootstrap();
