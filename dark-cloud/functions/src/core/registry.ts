import type { ZodType } from 'zod';
import type { Action, Module, ApprovalType } from '@dc/shared';
import type { Ctx, Tx } from './tx';

export interface MutationDef { kind: 'mutation'; schema: ZodType; perm: [Module, Action] | 'owner' | 'user' | 'any'; run: (tx: Tx, input: any) => Promise<unknown> }
export interface QueryDef { kind: 'query'; schema: ZodType; perm: [Module, Action] | 'owner' | 'user' | 'any'; run: (ctx: Ctx, input: any) => Promise<unknown> }
export type ActionDef = MutationDef | QueryDef;

export const ACTIONS_REGISTRY: Record<string, ActionDef> = {};
export function mutation(name: string, schema: ZodType, perm: MutationDef['perm'], run: MutationDef['run']) {
  ACTIONS_REGISTRY[name] = { kind: 'mutation', schema, perm, run };
}
export function query(name: string, schema: ZodType, perm: QueryDef['perm'], run: QueryDef['run']) {
  ACTIONS_REGISTRY[name] = { kind: 'query', schema, perm, run };
}

/** Executors run sensitive operations once approved. They must re-validate current state. */
export type Executor = (tx: Tx, payload: any) => Promise<unknown>;
export const EXECUTORS: Partial<Record<ApprovalType, Executor>> = {};
export function executor(type: ApprovalType, fn: Executor) { EXECUTORS[type] = fn; }
