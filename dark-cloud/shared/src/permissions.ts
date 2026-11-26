export const MODULES = [
  'dashboard', 'distributors', 'batches', 'payments', 'collection', 'expenses', 'purchases',
  'suppliers', 'inventory', 'assets', 'cash', 'reports', 'tasks', 'archive', 'team', 'settings', 'audit',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['view', 'create', 'edit', 'approve', 'cancel', 'export', 'print', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

export type Permissions = Partial<Record<Module, Action[]>>;

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: 'لوحة التحكم', distributors: 'الموزعون', batches: 'الدفعات والتسليمات', payments: 'السداد والتحصيل',
  collection: 'متابعة التحصيل', expenses: 'المصروفات', purchases: 'المشتريات', suppliers: 'الموردون',
  inventory: 'المخزون', assets: 'الأصول الثابتة', cash: 'الصناديق والحسابات', reports: 'التقارير',
  tasks: 'المهام', archive: 'الأرشيف', team: 'الفريق والصلاحيات', settings: 'الإعدادات', audit: 'سجل التدقيق',
};
export const ACTION_LABELS: Record<Action, string> = {
  view: 'عرض', create: 'إضافة', edit: 'تعديل', approve: 'اعتماد', cancel: 'إلغاء', export: 'تصدير', print: 'طباعة', manage: 'إدارة',
};

/** Modules whose create/edit/approve/cancel actions move money. Never granted by default. */
export const FINANCIAL_MODULES: Module[] = ['batches', 'payments', 'expenses', 'purchases', 'suppliers', 'inventory', 'assets', 'cash'];

export type UserKind = 'owner' | 'member' | 'portal';
export type UserStatus = 'active' | 'suspended';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  kind: UserKind;
  status: UserStatus;
  positions: string[];
  permissions: Permissions;
  /** Only for kind === 'portal': the single distributor this login may view. */
  portalDistributorId?: string | null;
}

export function can(user: Pick<UserProfile, 'kind' | 'status' | 'permissions'> | null | undefined, module: Module, action: Action): boolean {
  if (!user || user.status !== 'active') return false;
  if (user.kind === 'owner') return true;
  if (user.kind !== 'member') return false;
  return !!user.permissions?.[module]?.includes(action);
}

/** Validate a permissions object coming from a client. */
export function sanitizePermissions(input: unknown): Permissions {
  const out: Permissions = {};
  if (!input || typeof input !== 'object') return out;
  for (const m of MODULES) {
    const v = (input as Record<string, unknown>)[m];
    if (Array.isArray(v)) {
      const acts = ACTIONS.filter((a) => v.includes(a));
      if (acts.length) out[m] = acts;
    }
  }
  return out;
}
