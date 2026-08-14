import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { listAliases, createAlias, deleteAlias } from '../services/aliasService';

export const listAliasesController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { entity_type } = req.query as { entity_type?: string };
    const aliases = await listAliases(entity_type);
    res.json(aliases);
  } catch (error) {
    next(error);
  }
};

export const createAliasController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { entity_type, canonical, alias } = req.body;
    const created = await createAlias(entity_type, canonical, alias, req.user?.id);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
};

export const deleteAliasController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    await deleteAlias(id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};
