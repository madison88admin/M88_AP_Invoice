import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { UserRole } from '@ap-invoice/shared';
import { getMsalApp } from '../config/msal';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
  uploadedFile?: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    size: number;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401);
    }

    const token = authHeader.substring(7);
    
    // Try JWT first (for development/testing)
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
        req.user = {
          id: decoded.id,
          email: decoded.email,
          name: decoded.name,
          role: decoded.role,
        };
        return next();
      } catch (jwtError) {
        // JWT failed, try MSAL
      }
    }

    // MSAL authentication for production
    try {
      const msalApp = getMsalApp();
      if (!msalApp) {
        throw new AppError('MSAL not configured — set AZURE_CLIENT_ID and AZURE_CLIENT_SECRET', 500);
      }

      const oboRequest = {
        scopes: ['https://graph.microsoft.com/.default'],
        oboAssertion: token,
      };
      
      const response = await msalApp.acquireTokenOnBehalfOf(oboRequest);
      
      // Extract user info from the token
      const decoded = jwt.decode(token) as any;
      
      req.user = {
        id: decoded.oid || decoded.sub,
        email: decoded.email || decoded.upn,
        name: decoded.name || decoded.preferred_username,
        role: decoded.roles?.[0] || UserRole.ACCOUNTING_ASSOCIATE, // Default role if not specified
      };
      
      next();
    } catch (msalError) {
      throw new AppError('Invalid or expired token', 401);
    }
  } catch (error) {
    next(new AppError('Authentication failed', 401));
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};
