import type { Minor } from './money';

export type BatchStatus = 'draft' | 'open' | 'finalized' | 'cancelled' | 'returned';
export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  draft: 'جديدة (لم تُسلَّم)', open: 'مفتوحة — عهدة', finalized: 'معتمدة — مستحقة', cancelled: 'ملغاة', returned: 'مرتجعة',
};
export type SettlementStatus = 'unpaid' | 'partial' | 'paid';
export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = { unpaid: 'غير مسددة', partial: 'مسددة جزئياً', paid: 'مسددة' };

export type DistributorStatus = 'active' | 'suspended' | 'closed';
export const DISTRIBUTOR_STATUS_LABELS: Record<DistributorStatus, string> = { active: 'نشط', suspended: 'موقوف', closed: 'مغلق' };

export type DocStatus = 'posted' | 'cancelled';
export type PurchaseStatus = 'pending' | 'approved' | 'cancelled';
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = { pending: 'بانتظار الاعتماد والاستلام', approved: 'معتمدة ومستلمة', cancelled: 'ملغاة' };
export type PaymentState = 'unpaid' | 'partial' | 'paid';
export const PAY_STATE_LABELS: Record<PaymentState, string> = { unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئياً', paid: 'مدفوعة بالكامل' };

export type TaskStatus = 'new' | 'assigned' | 'in_progress' | 'review' | 'done' | 'cancelled';
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { new: 'جديدة', assigned: 'مُسندة', in_progress: 'قيد التنفيذ', review: 'بانتظار المراجعة', done: 'مكتملة', cancelled: 'ملغاة' };
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const PRIORITY_LABELS: Record<Priority, string> = { low: 'منخفضة', normal: 'عادية', high: 'عالية', urgent: 'عاجلة' };

export type ApprovalType =
  | 'payment.cancel' | 'batch.cancelFinalized' | 'batch.creditOverride' | 'distributor.adjust' | 'distributor.changeTerms'
  | 'cash.reconcile' | 'inventory.adjust' | 'expense.cancel' | 'purchase.cancel' | 'supplierPayment.cancel';
export const APPROVAL_LABELS: Record<ApprovalType, string> = {
  'payment.cancel': 'إلغاء سند قبض', 'batch.cancelFinalized': 'إلغاء دفعة معتمدة', 'batch.creditOverride': 'تجاوز الحد الائتماني',
  'distributor.adjust': 'تسوية رصيد موزع', 'distributor.changeTerms': 'تعديل عمولة/حد ائتماني لموزع',
  'cash.reconcile': 'فرق جرد صندوق', 'inventory.adjust': 'تسوية مخزون', 'expense.cancel': 'إلغاء مصروف',
  'purchase.cancel': 'إلغاء مشتريات معتمدة', 'supplierPayment.cancel': 'إلغاء سداد مورد',
};

export type CashAccountType = 'cash' | 'bank' | 'wallet';
export const CASH_TYPE_LABELS: Record<CashAccountType, string> = { cash: 'صندوق نقدي', bank: 'حساب بنكي', wallet: 'محفظة إلكترونية' };

export type InventoryMoveType = 'receipt' | 'issue' | 'return' | 'transfer' | 'count' | 'damage';
export const MOVE_LABELS: Record<InventoryMoveType, string> = { receipt: 'استلام', issue: 'صرف', return: 'مرتجع للمخزن', transfer: 'تحويل بين مخازن', count: 'جرد فعلي', damage: 'تالف' };

export interface NamedItem { id: string; name: string; active?: boolean }
export interface CardCategory extends NamedItem { unitPriceMinor: Minor }
export interface Currency { code: string; name: string; active: boolean }

export interface Settings {
  company: { nameAr: string; nameEn: string; managerName: string; phone: string; whatsapp: string; email: string; address: string; invoiceHeader: string; invoiceFooter: string };
  finance: {
    baseCurrency: string; defaultCommissionPct: number; defaultCreditLimitMinor: Minor; precision: number; fiscalYearStartMonth: number;
    creditPolicy: 'warn' | 'block'; exposureBasis: 'net' | 'gross'; agingBounds: [number, number, number]; allowNegativeInventory: boolean;
  };
  lists: {
    paymentMethods: NamedItem[]; expenseCategories: NamedItem[]; cardCategories: CardCategory[]; regions: NamedItem[];
    distributorCategories: NamedItem[]; currencies: Currency[]; assetCategories: NamedItem[]; inventoryCategories: NamedItem[];
  };
  system: { timezone: string; dateFormat: 'DD/MM/YYYY'; portalEnabled: boolean; lowStockAlerts: boolean; overdueReceivableDays: number };
}

/** Initial configurable settings. Card denominations come from the audited Excel workbook (sheet الإعدادات). */
export const DEFAULT_SETTINGS: Settings = {
  company: { nameAr: 'شبكة دارك كلاود اللاسلكية', nameEn: 'DARK-CLOUD NETWORK', managerName: 'المهندس توهيب السيفي', phone: '', whatsapp: '', email: '', address: '', invoiceHeader: '', invoiceFooter: '' },
  finance: { baseCurrency: 'YER', defaultCommissionPct: 10, defaultCreditLimitMinor: 500000_00, precision: 0, fiscalYearStartMonth: 1,
    creditPolicy: 'warn', exposureBasis: 'net', agingBounds: [7, 15, 30], allowNegativeInventory: false },
  lists: {
    paymentMethods: [{ id: 'cash', name: 'نقداً' }, { id: 'bank', name: 'تحويل بنكي' }, { id: 'remittance', name: 'حوالة' }, { id: 'other', name: 'أخرى' }],
    expenseCategories: [
      { id: 'rent', name: 'إيجار' }, { id: 'electricity', name: 'كهرباء' }, { id: 'utilities', name: 'خدمات ومرافق' },
      { id: 'salaries', name: 'رواتب ومكافآت' }, { id: 'transport', name: 'مواصلات' }, { id: 'hospitality', name: 'ضيافة' },
      { id: 'maintenance', name: 'صيانة عامة' }, { id: 'communications', name: 'اتصالات' }, { id: 'subscriptions', name: 'اشتراكات' }, { id: 'other', name: 'أخرى' },
    ],
    cardCategories: [200, 300, 500, 1000, 3000, 8000].map((v) => ({ id: `c${v}`, name: `فئة ${v}`, unitPriceMinor: v * 100, active: true })),
    regions: [], distributorCategories: [],
    currencies: [{ code: 'YER', name: 'ريال يمني', active: true }, { code: 'SAR', name: 'ريال سعودي', active: true }, { code: 'USD', name: 'دولار أمريكي', active: true }],
    assetCategories: [{ id: 'equipment', name: 'معدات' }, { id: 'devices', name: 'أجهزة' }, { id: 'furniture', name: 'أثاث' }, { id: 'infrastructure', name: 'بنية إدارية' }],
    inventoryCategories: [{ id: 'cables', name: 'كيابل' }, { id: 'spares', name: 'قطع غيار' }, { id: 'consumables', name: 'مستهلكات' }, { id: 'supplies', name: 'مستلزمات تشغيل' }],
  },
  system: { timezone: 'Asia/Aden', dateFormat: 'DD/MM/YYYY', portalEnabled: false, lowStockAlerts: true, overdueReceivableDays: 30 },
};
