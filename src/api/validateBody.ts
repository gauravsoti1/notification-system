import type { Request, Response, NextFunction } from 'express';
import z from 'zod';

export function validateBody<T extends z.ZodObject>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.message,
        });
      }
      next(error);
    }
  };
}
