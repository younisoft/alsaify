import { z } from 'zod';
import { isValidISODate } from './dates';
import { MODULES, ACTIONS } from './permissions';

export const zDate = z.string().refine(isValidISODate, 'تاريخ غير صالح');
export const zAmount = z.number().finite().positive('المبلغ يجب أن يكون أكبر من صفر').max(1e12);
export const zSignedAmount = z.number().finite().min(-1e12).max(1e12);
export const zRate = z.number().finite().positive('سعر الصرف يجب أن يكون أكبر من صفر').max(1e7);
export const zId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/);
export const zText = (max = 400) => z.string().trim().max(max);
export const zReq = (max = 200) => z.string().trim().min(1, 'حقل مطلوب').max(max);
export const zCurrency = z.string().regex(/^[A-Z]{3}$/);
export const zPermissions = z.partialRecord(z.enum(MODULES), z.array(z.enum(ACTIONS)));

const fx = { currency: zCurrency, rate: zRate.optional(), rateDate: zDate.optional(), rateSource: zText(60).optional() };

export const S = {
  invite: z.object({ email: z.string().trim().toLowerCase().email(), displayName: zReq(100), positions: z.array(zText(60)).max(5).default([]),
    kind: z.enum(['member', 'portal']), permissions: zPermissions.default({}), portalDistributorId: zId.optional().nullable() }),
  updateUser: z.object({ uid: zId, displayName: zReq(100).optional(), positions: z.array(zText(60)).max(5).optional(), permissions: zPermissions.optional(), portalDistributorId: zId.nullable().optional() }),
  setUserStatus: z.object({ uid: zId, status: z.enum(['active', 'suspended']), reason: zReq(300) }),
  idOnly: z.object({ id: zId }),
  idReason: z.object({ id: zId, reason: zReq(300) }),

  settingsUpdate: z.object({ section: z.enum(['company', 'finance', 'lists', 'system']), data: z.record(z.string(), z.unknown()) }),
  exchangeRate: z.object({ currency: zCurrency, rate: zRate, date: zDate, source: zText(60).default('يدوي') }),

  distributorCreate: z.object({ name: zReq(120), shopName: zText(120).default(''), region: zText(80).default(''), category: zText(60).default(''),
    phone: zReq(30), whatsapp: zText(30).default(''), commissionPct: z.number().min(0).max(100).optional(), creditLimit: z.number().min(0).max(1e12).optional(),
    openingBalance: zSignedAmount.default(0), startDate: zDate, notes: zText().default('') }),
  distributorUpdate: z.object({ id: zId, name: zReq(120).optional(), shopName: zText(120).optional(), region: zText(80).optional(), category: zText(60).optional(),
    phone: zReq(30).optional(), whatsapp: zText(30).optional(), notes: zText().optional() }),
  distributorStatus: z.object({ id: zId, status: z.enum(['active', 'suspended', 'closed']), reason: zReq(300) }),
  distributorTerms: z.object({ id: zId, commissionPct: z.number().min(0).max(100).nullable().optional(), creditLimit: z.number().min(0).max(1e12).nullable().optional(), reason: zReq(300) }),
  distributorAdjust: z.object({ id: zId, kind: z.enum(['debit', 'credit']), amount: zAmount, date: zDate, reason: zReq(300) }),

  batchCreate: z.object({ distributorId: zId, deliveryDate: zDate, notes: zText().default(''), deliverNow: z.boolean().default(true), overrideReason: zText(300).optional(),
    lines: z.array(z.object({ categoryId: zId, quantity: z.number().int().positive().max(1_000_000), unitPrice: zAmount.optional() })).min(1).max(30) }),
  batchDeliver: z.object({ id: zId, overrideReason: zText(300).optional() }),
  batchFinalize: z.object({ id: zId, settlementDate: zDate }),
  batchReturn: z.object({ id: zId, date: zDate, reason: zReq(300) }),

  allocation: z.object({ mode: z.enum(['none', 'fifo', 'manual']), items: z.array(z.object({ targetType: z.enum(['batch', 'charge']), targetId: zId, amount: zAmount })).max(100).default([]) }),
  paymentCreate: z.object({ distributorId: zId, date: zDate, amount: zAmount, ...fx, methodId: zId, cashAccountId: zId, reference: zText(80).default(''), notes: zText().default(''),
    allocation: z.object({ mode: z.enum(['none', 'fifo', 'manual']), items: z.array(z.object({ targetType: z.enum(['batch', 'charge']), targetId: zId, amount: zAmount })).max(100).default([]) }) }),
  paymentReallocate: z.object({ id: zId, allocation: z.object({ mode: z.enum(['none', 'fifo', 'manual']), items: z.array(z.object({ targetType: z.enum(['batch', 'charge']), targetId: zId, amount: zAmount })).max(100).default([]) }), reason: zReq(300) }),

  followUp: z.object({ id: zId.optional(), distributorId: zId, nextFollowUpDate: zDate, contactStatus: z.enum(['not_contacted', 'contacted', 'no_answer', 'promised', 'refused', 'settled']),
    promisedAmount: z.number().min(0).max(1e12).optional(), promiseDate: zDate.optional(), notes: zText().default(''), assignedTo: zId.optional() }),

  expenseCreate: z.object({ date: zDate, categoryId: zId, description: zReq(300), amount: zAmount, ...fx, cashAccountId: zId, methodId: zId,
    supplierId: zId.optional(), assetId: zId.optional(), notes: zText().default('') }),

  supplierCreate: z.object({ name: zReq(120), phone: zText(30).default(''), address: zText(200).default(''), email: zText(120).default(''), preferredCurrency: zCurrency.default('YER'),
    openingBalance: zSignedAmount.default(0), openingDate: zDate.optional(), notes: zText().default('') }),
  supplierUpdate: z.object({ id: zId, name: zReq(120).optional(), phone: zText(30).optional(), address: zText(200).optional(), email: zText(120).optional(), preferredCurrency: zCurrency.optional(), notes: zText().optional(), status: z.enum(['active', 'inactive']).optional() }),
  supplierPay: z.object({ supplierId: zId, date: zDate, amount: zAmount, ...fx, cashAccountId: zId, methodId: zId, purchaseId: zId.optional(), notes: zText().default('') }),

  purchaseCreate: z.object({ date: zDate, supplierId: zId.optional(), classification: z.enum(['operational', 'capital']), categoryId: zText(60).default(''), ...fx,
    lines: z.array(z.object({ description: zReq(200), itemId: zId.optional(), warehouseId: zId.optional(), quantity: z.number().positive().max(1e7), unitPrice: zAmount })).min(1).max(50),
    paidAmount: z.number().min(0).max(1e12).default(0), cashAccountId: zId.optional(), methodId: zId.optional(), notes: zText().default(''),
    asset: z.object({ name: zReq(120), categoryId: zText(60).default(''), location: zText(120).default(''), responsible: zText(100).default(''), warrantyUntil: zDate.optional(),
      usefulLifeMonths: z.number().int().positive().max(1200).optional(), residualValue: z.number().min(0).optional(), inServiceDate: zDate.optional() }).optional() }),

  itemCreate: z.object({ name: zReq(120), categoryId: zText(60).default(''), unit: zReq(30), minQuantity: z.number().min(0).default(0), location: zText(120).default(''), supplierId: zId.optional(), notes: zText().default('') }),
  itemUpdate: z.object({ id: zId, name: zReq(120).optional(), categoryId: zText(60).optional(), unit: zReq(30).optional(), minQuantity: z.number().min(0).optional(), location: zText(120).optional(), supplierId: zId.optional(), notes: zText().optional(), status: z.enum(['active', 'inactive']).optional() }),
  warehouseCreate: z.object({ name: zReq(80), location: zText(120).default('') }),
  inventoryMove: z.object({ type: z.enum(['issue', 'return', 'transfer', 'count', 'damage']), itemId: zId, warehouseId: zId, toWarehouseId: zId.optional(),
    quantity: z.number().min(0).max(1e7), date: zDate, reference: zText(80).default(''), notes: zText().default('') }),

  assetCreate: z.object({ name: zReq(120), categoryId: zText(60).default(''), purchaseDate: zDate, supplierId: zId.optional(), cost: zAmount, ...fx, location: zText(120).default(''),
    responsible: zText(100).default(''), warrantyUntil: zDate.optional(), usefulLifeMonths: z.number().int().positive().max(1200).optional(), residualValue: z.number().min(0).optional(),
    inServiceDate: zDate.optional(), notes: zText().default('') }),
  assetUpdate: z.object({ id: zId, name: zReq(120).optional(), location: zText(120).optional(), responsible: zText(100).optional(), status: z.enum(['in_service', 'maintenance', 'retired']).optional(),
    usefulLifeMonths: z.number().int().positive().max(1200).optional(), residualValue: z.number().min(0).optional(), inServiceDate: zDate.optional(), warrantyUntil: zDate.optional() }),
  depreciationRun: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),

  cashAccountCreate: z.object({ name: zReq(80), type: z.enum(['cash', 'bank', 'wallet']), currency: zCurrency, openingBalance: zSignedAmount.default(0), openingDate: zDate, rate: zRate.optional() }),
  cashTransfer: z.object({ fromId: zId, toId: zId, amount: zAmount, date: zDate, notes: zText().default('') }),
  cashOther: z.object({ accountId: zId, kind: z.enum(['other_income', 'owner_capital', 'owner_withdrawal']), amount: zAmount, date: zDate, rate: zRate.optional(), description: zReq(200) }),
  cashReconcile: z.object({ accountId: zId, date: zDate, actualBalance: zSignedAmount, reason: zText(300).default('') }),

  taskUpsert: z.object({ id: zId.optional(), title: zReq(160), description: zText(2000).default(''), assigneeUid: zId.optional().nullable(), startDate: zDate.optional(), dueDate: zDate.optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), relatedModule: zText(40).optional(), relatedId: zId.optional() }),
  taskStatus: z.object({ id: zId, status: z.enum(['new', 'assigned', 'in_progress', 'review', 'done', 'cancelled']) }),
  taskComment: z.object({ id: zId, text: zReq(2000) }),

  approvalDecide: z.object({ id: zId, decision: z.enum(['approve', 'reject']), note: zText(300).default('') }),
  period: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
  documentRegister: z.object({ module: z.enum(MODULES), recordId: zId, path: z.string().min(1).max(400), name: zReq(200), size: z.number().int().positive().max(10 * 1024 * 1024), contentType: z.string().max(100) }),
  markRead: z.object({ ids: z.array(zId).max(200) }),

  range: z.object({ from: zDate.optional(), to: zDate.optional() }),
  year: z.object({ year: z.number().int().min(2000).max(2100) }),
  asOf: z.object({ asOf: zDate.optional() }),
  statement: z.object({ id: zId, from: zDate.optional(), to: zDate.optional() }),
};
