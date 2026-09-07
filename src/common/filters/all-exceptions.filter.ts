import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = null;
    let errorCode: string | null = null;
    let retryAfterSeconds: number | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const res = exceptionResponse as any;
        message = res.message || message;
        errors = Array.isArray(res.message) ? res.message : null;
        if (errors) message = 'Validation failed';
        // P0-4.4: preserve the machine-readable code so callers and dashboards can
        // tell EDVA admission control (ai_admission_rejected / _unavailable) apart
        // from a monthly quota 429 (ai_quota_exceeded) and from a provider 429.
        if (typeof res.error === 'string') errorCode = res.error;
        if (typeof res.retryAfterSeconds === 'number') retryAfterSeconds = res.retryAfterSeconds;
      }
    } else if (exception instanceof Error) {
      // Never expose raw error messages to clients — they may contain table names,
      // column constraints, or internal service details from TypeORM/Postgres.
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
      message = 'An unexpected error occurred. Please try again or contact support.';
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logMessage = `[${new Date().toISOString()}] ${request.method} ${request.url}\nStatus: ${status}\nError: ${exception instanceof Error ? exception.stack : JSON.stringify(exception)}\n\n`;
      fs.appendFileSync(path.join(logDir, 'error.log'), logMessage);
    } catch (e) {
      // ignore log failures
    }

    // P0-4.4: a retryable rejection must tell the client WHEN to come back.
    if (retryAfterSeconds !== null) {
      try { response.setHeader('Retry-After', String(retryAfterSeconds)); } catch { /* headers sent */ }
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      ...(errorCode ? { error: errorCode } : {}),
      ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
      errors,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
