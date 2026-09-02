import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error(err.stack);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        status: err.statusCode,
      },
    });
  }

  // Invalid OCR/manual form values should be actionable to the user rather
  // than appearing as an opaque server failure. Do not expose the underlying
  // Prisma query or database details in the response.
  if (err.name === 'PrismaClientValidationError') {
    return res.status(400).json({
      error: {
        message: 'One or more invoice fields contain an invalid value. Please review the extracted fields and try again.',
        status: 400,
      },
    });
  }

  res.status(500).json({
    error: {
      message: 'Internal server error',
      status: 500,
    },
  });
};
