import { Request, Response, NextFunction } from 'express';
export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
}
export const notFound = (req: Request, _r: Response, next: NextFunction) => next(new AppError(`Not found: ${req.originalUrl}`, 404));
export const errorHandler = (err: AppError, _req: Request, res: Response, _n: NextFunction) => {
  let { statusCode = 500, message } = err;
  if ((err as any).code === 11000) { message = `${Object.keys((err as any).keyValue)[0]} already exists`; statusCode = 409; }
  res.status(statusCode).json({ success: false, message });
};
