import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiException } from '../exceptions/api.exception';
import { LoggerService } from '../logger.service';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: any;
    let suggestions: string[] = [];

    if (exception instanceof ApiException) {
      statusCode = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
      suggestions = exception.suggestions || [];
    } else if (exception instanceof Error) {
      message = exception.message;
      details = { stack: exception.stack };
    }

    this.logger.error(
      `Error: ${code} - ${message}`,
      details?.stack || '',
      'ApiExceptionFilter',
    );

    response.status(statusCode).json({
      success: false,
      error: { code, message, details, suggestions },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: request['id'] || 'unknown',
        executionTime: Date.now() - (request['startTime'] || Date.now()),
      },
    });
  }
}
