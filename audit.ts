import type { Request } from 'express';
import { Db } from '../db';

export interface AuditEvent { action: string; resourceType?: string; resourceId?: string; meta?: Record<string, unknown> }

/** Append one audit row. `soft` (default) never fails the request: losing an audit row is logged loudly, not allowed to break care. */
export async function audit(db: Db, req: Pick<Request, 'user' | 'ip'> & { id?: string }, e: AuditEvent, soft = true) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_id, actor_role, action, resource_type, resource_id, ip, request_id, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.user?.id ?? null, req.user?.role ?? null, e.action, e.resourceType ?? null, e.resourceId ?? null, req.ip ?? null, req.id ?? null, JSON.stringify(e.meta ?? {})]);
  } catch (err) {
    if (!soft) throw err;
    console.error('[audit] failed to write', e.action, (err as Error).message);
  }
}

export async function listAudit(db: Db, f: { actorId?: string; action?: string; resourceId?: string; limit: number }) {
  const r = await db.query(
    `SELECT id, at, actor_id, actor_role, action, resource_type, resource_id, ip, request_id, meta FROM audit_log
     WHERE ($1::uuid IS NULL OR actor_id=$1) AND ($2::text IS NULL OR action=$2) AND ($3::text IS NULL OR resource_id=$3)
     ORDER BY id DESC LIMIT $4`, [f.actorId ?? null, f.action ?? null, f.resourceId ?? null, f.limit]);
  return r.rows;
}
