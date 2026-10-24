import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Liveness probe for container orchestration (Docker HEALTHCHECK, load balancers).
 * Deliberately has no dependencies: it must answer even when the DB, Redis or
 * the AI service are down, so the container is not restarted for upstream outages.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
