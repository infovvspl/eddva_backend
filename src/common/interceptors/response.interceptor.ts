import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const response = context.switchToHttp().getResponse();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data) => {
        // If handler already returned a shaped response, pass through
        if (data && typeof data === 'object' && 'success' in data) return data;

        if (data && typeof data === 'object' && data?.data !== undefined) {
          const { data: payload, message, ...meta } = data as Record<string, unknown>;
          return {
            success: true,
            statusCode,
            message: (message as string) || 'Success',
            data: payload as T,
            ...meta,
            timestamp: new Date().toISOString(),
          };
        }

        return {
          success: true,
          statusCode,
          message: data?.message || 'Success',
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
