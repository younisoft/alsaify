import { useState } from 'react';
import { orderBy, limit } from 'firebase/firestore';
import { Plus, ArrowDownUp, Warehouse, Calculator } from 'lucide-react';
import { MOVE_LABELS, formatDate } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection } from '../lib/hooks';
import { api } from '../lib/api';
import { major } from '../lib/format';
import { Badge, Button, DataView, Field, FormModal, Grid, Input, Kpi, Note, PageHeader, Select, Textarea, Tabs, useToast, Modal, Card, Stat } from '../components/ui';
import { Money, today, useSupplierOptions, num, Documents, History } from './common';

export function InventoryPage() {
  const { can, settings } = useAuth();
  const items = useCollection<any>('inventory_items', [orderBy('code')]);
  const whs = useCollection<any>('warehouses', []);
  const moves = useCollection<any>('inventory_movements', [orderBy('date', 'desc'), limit(500)]);
  const [tab, setTab] = useState<'items' | 'moves' | 'whs'>('items');
  const [m, setM] = useState<'' | 'item' | 'move' | 'wh'>('');
  const whName = (id: string) => whs.data.find((w) => w.id === id)?.name ?? id;
  const low = items.data.filter((i) => i.status === 'active' && (i.qtyTotal || 0) < (i.minQuantity || 0));
  return (
    <>
      <PageHeader title="المخزون الإداري" subtitle="لا يزيد المخزون إلا بعد اعتماد استلام المشتريات. الصرف بمتوسط التكلفة المرجّح." crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'المخزون' }]}
        actions={<>
          {can('inventory', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setM('item')}>صنف جديد</Button>}
          {can('inventory', 'create') && <Button icon={<ArrowDownUp className="h-4 w-4" />} onClick={() => setM('move')}>حركة مخزنية</Button>}
          {can('inventory', 'manage') && <Button icon={<Warehouse className="h-4 w-4" />} onClick={() => setM('wh')}>مخزن جديد</Button>}
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="قيمة المخزون (تقديرية)" value={<Money v={items.data.reduce((a, i) => a + Math.round((i.qtyTotal || 0) * (i.avgCostMinor || 0)), 0)} />} basis="balance" />
        <Kpi label="أصناف تحت الحد الأدنى" value={low.length} tone={low.length ? 'bad' : 'ok'} />
        <Kpi label="عدد الأصناف" value={items.data.length} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'items', label: 'الأصناف', count: items.data.length }, { id: 'moves', label: 'الحركات' }, { id: 'whs', label: 'المخازن', count: whs.data.length }]} />
      {tab === 'items' && <DataView rows={items.data} loading={items.loading} error={items.error} exportName="inventory" title="تقرير المخزون" search={(i) => `${i.code} ${i.name}`} columns={[
        { key: 'code', label: 'الكود', mobile: 'meta' }, { key: 'name', label: 'الصنف', mobile: 'title' },
        { key: 'cat', label: 'الفئة', mobile: 'sub', value: (i) => settings.lists.inventoryCategories.find((c) => c.id === i.categoryId)?.name ?? '—' },
        { key: 'stock', label: 'التوزيع على المخازن', value: (i) => Object.entries(i.stock || {}).map(([w, q]) => `${whName(w)}: ${q}`).join('، ') || '—' },
        { key: 'qty', label: 'الكمية', align: 'end', mobile: 'amount', value: (i) => i.qtyTotal, render: (i) => <span className={(i.qtyTotal || 0) < (i.minQuantity || 0) ? 'font-bold text-bad' : 'num'}>{i.qtyTotal} {i.unit}</span> },
        { key: 'min', label: 'الحد الأدنى', align: 'end', value: (i) => i.minQuantity },
        { key: 'avg', label: 'متوسط التكلفة', align: 'end', value: (i) => major(i.avgCostMinor), render: (i) => <Money v={i.avgCostMinor} /> },
      ]} />}
      {tab === 'moves' && <DataView rows={moves.data} loading={moves.loading} error={moves.error} exportName="inventory-movements" title="حركات المخزون" search={(x) => `${x.itemName} ${x.reference}`} columns={[
        { key: 'date', label: 'التاريخ', mobile: 'sub', value: (x) => formatDate(x.date) }, { key: 'itemName', label: 'الصنف', mobile: 'title' },
        { key: 'type', label: 'النوع', mobile: 'meta', value: (x) => MOVE_LABELS[x.type as keyof typeof MOVE_LABELS], render: (x) => <Badge tone={x.quantity >= 0 ? 'ok' : 'warn'}>{MOVE_LABELS[x.type as keyof typeof MOVE_LABELS]}</Badge> },
        { key: 'qty', label: 'الكمية', align: 'end', mobile: 'amount', value: (x) => x.quantity, render: (x) => <span className="num font-semibold">{x.quantity > 0 ? '+' : ''}{x.quantity}</span> },
        { key: 'wh', label: 'المخزن', value: (x) => `${whName(x.warehouseId)}${x.toWarehouseId ? ` ← ${whName(x.toWarehouseId)}` : ''}` },
        { key: 'value', label: 'القيمة', align: 'end', value: (x) => major(x.valueMinor), render: (x) => <Money v={x.valueMinor} /> },
        { key: 'ref', label: 'المرجع', value: (x) => x.reference || '—' }, { key: 'by', label: 'المستخدم', value: (x) => x.createdByName },
      ]} />}
      {tab === 'whs' && <DataView rows={whs.data} loading={whs.loading} columns={[{ key: 'name', label: 'المخزن', mobile: 'title' }, { key: 'location', label: 'الموقع', mobile: 'sub', value: (w) => w.location || '—' }]} />}
      {m === 'item' && <ItemForm onClose={() => setM('')} />}
      {m === 'move' && <MoveForm items={items.data} whs={whs.data} onClose={() => setM('')} />}
      {m === 'wh' && <WarehouseForm onClose={() => setM('')} />}
    </>
  );
}
function ItemForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const { settings } = useAuth(); const sup = useSupplierOptions();
  const [f, setF] = useState({ name: '', categoryId: settings.lists.inventoryCategories[0]?.id || '', unit: 'قطعة', minQuantity: '0', location: '', supplierId: '', notes: '' });
  return (
    <FormModal open onClose={onClose} title="صنف مخزني جديد" onSubmit={async () => { const r = await api('inventory.createItem', { ...f, minQuantity: Number(f.minQuantity), supplierId: f.supplierId || undefined }); toast(`تمت إضافة الصنف ${r.code}`); }}>
      <Grid>
        <Field label="الاسم" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="الفئة"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={settings.lists.inventoryCategories.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="الوحدة" required><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="الحد الأدنى"><Input type="number" value={f.minQuantity} onChange={(e) => setF({ ...f, minQuantity: e.target.value })} /></Field>
        <Field label="موقع التخزين"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="المورد الرئيسي"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} placeholder="—" options={sup} /></Field>
      </Grid>
      <Note>الكمية الافتتاحية تُدخل عبر «جرد فعلي» (يتطلب اعتماداً) أو عبر فاتورة مشتريات معتمدة.</Note>
    </FormModal>
  );
}
function WarehouseForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const [f, setF] = useState({ name: '', location: '' });
  return <FormModal open onClose={onClose} title="مخزن جديد" onSubmit={async () => { await api('inventory.createWarehouse', f); toast('تمت إضافة المخزن'); }}>
    <Field label="الاسم" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="الموقع"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field></FormModal>;
}
function MoveForm({ items, whs, onClose }: { items: any[]; whs: any[]; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ type: 'issue', itemId: '', warehouseId: whs[0]?.id || '', toWarehouseId: '', quantity: '', date: today(), reference: '', notes: '' });
  const it = items.find((i) => i.id === f.itemId);
  return (
    <FormModal open onClose={onClose} title="حركة مخزنية" onSubmit={async () => {
      const r = await api('inventory.move', { ...f, quantity: Number(f.quantity), toWarehouseId: f.toWarehouseId || undefined });
      toast(r.executed === false ? 'أُرسلت التسوية للاعتماد' : 'تم تسجيل الحركة', r.executed === false ? 'warn' : 'ok');
    }}>
      <Grid>
        <Field label="نوع الحركة"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: 'issue', label: 'صرف للاستخدام' }, { value: 'return', label: 'إرجاع للمخزن' }, { value: 'transfer', label: 'تحويل بين مخازن' }, { value: 'count', label: 'جرد فعلي (يتطلب اعتماداً عند الفرق)' }, { value: 'damage', label: 'تالف (يتطلب اعتماداً)' }]} /></Field>
        <Field label="الصنف" required><Select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })} placeholder="اختر" options={items.map((i) => ({ value: i.id, label: `${i.name} (${i.qtyTotal} ${i.unit})` }))} /></Field>
        <Field label="المخزن" required><Select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })} options={whs.map((w) => ({ value: w.id, label: `${w.name}${it ? ` — متاح ${it.stock?.[w.id] || 0}` : ''}` }))} /></Field>
        {f.type === 'transfer' && <Field label="إلى مخزن" required><Select value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })} placeholder="اختر" options={whs.filter((w) => w.id !== f.warehouseId).map((w) => ({ value: w.id, label: w.name }))} /></Field>}
        <Field label={f.type === 'count' ? 'الكمية الفعلية المعدودة' : 'الكمية'} required><Input type="number" min="0" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="التاريخ" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="المرجع"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </Grid>
      <Field label="ملاحظات / السبب"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </FormModal>
  );
}

// ================================================================== ASSETS
export function AssetsPage() {
  const { can, settings } = useAuth();
  const r = useCollection<any>('assets', [orderBy('code')]);
  const [m, setM] = useState<'' | 'new' | 'dep'>(''); const [sel, setSel] = useState<any>(null);
  const live = r.data.filter((a) => a.status !== 'cancelled');
  return (
    <>
      <PageHeader title="الأصول الثابتة" subtitle="التكلفة ومجمع الإهلاك والقيمة الدفترية وتكاليف الصيانة منفصلة. لا يُفترض عمر إنتاجي أو قيمة متبقية." crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الأصول' }]}
        actions={<>
          {can('assets', 'approve') && <Button icon={<Calculator className="h-4 w-4" />} onClick={() => setM('dep')}>احتساب إهلاك شهر</Button>}
          {can('assets', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setM('new')}>تسجيل أصل قائم</Button>}
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="تكلفة الاقتناء" value={<Money v={live.reduce((a, x) => a + x.costMinor, 0)} />} />
        <Kpi label="مجمع الإهلاك" value={<Money v={live.reduce((a, x) => a + x.accumulatedDepMinor, 0)} />} tone="gold" />
        <Kpi label="القيمة الدفترية" value={<Money v={live.reduce((a, x) => a + x.costMinor - x.accumulatedDepMinor, 0)} />} tone="brand" />
        <Kpi label="تكاليف الصيانة (مصروفات)" value={<Money v={live.reduce((a, x) => a + (x.maintenanceMinor || 0), 0)} />} tone="warn" />
      </div>
      <Note>الأصول المشتراة تُسجَّل تلقائياً عند اعتماد فاتورة مشتريات رأسمالية. استخدم «تسجيل أصل قائم» فقط للأصول الموجودة قبل بدء النظام.</Note>
      <div className="mt-3"><DataView rows={r.data} loading={r.loading} error={r.error} onRowClick={setSel} exportName="assets" title="سجل الأصول الثابتة" search={(a) => `${a.code} ${a.name} ${a.location}`} columns={[
        { key: 'code', label: 'الكود', mobile: 'meta' }, { key: 'name', label: 'الأصل', mobile: 'title' },
        { key: 'cat', label: 'الفئة', value: (a) => settings.lists.assetCategories.find((c) => c.id === a.categoryId)?.name ?? '—' },
        { key: 'loc', label: 'الموقع / المسؤول', mobile: 'sub', value: (a) => [a.location, a.responsible].filter(Boolean).join(' · ') || '—' },
        { key: 'cost', label: 'التكلفة', align: 'end', value: (a) => major(a.costMinor), render: (a) => <Money v={a.costMinor} /> },
        { key: 'dep', label: 'مجمع الإهلاك', align: 'end', value: (a) => major(a.accumulatedDepMinor), render: (a) => <Money v={a.accumulatedDepMinor} /> },
        { key: 'book', label: 'القيمة الدفترية', align: 'end', mobile: 'amount', value: (a) => major(a.costMinor - a.accumulatedDepMinor), render: (a) => <Money v={a.costMinor - a.accumulatedDepMinor} /> },
        { key: 'policy', label: 'سياسة الإهلاك', value: (a) => (a.usefulLifeMonths ? `${a.usefulLifeMonths} شهر` : 'غير محددة'), render: (a) => (a.usefulLifeMonths && a.residualMinor != null ? `${a.usefulLifeMonths} شهر` : <Badge tone="warn">غير محددة</Badge>) },
        { key: 'status', label: 'الحالة', value: (a) => a.status, render: (a) => <Badge tone={a.status === 'in_service' ? 'ok' : 'neutral'}>{({ in_service: 'في الخدمة', maintenance: 'صيانة', retired: 'خارج الخدمة', cancelled: 'ملغى' } as any)[a.status]}</Badge> },
      ]} /></div>
      {m === 'new' && <AssetForm onClose={() => setM('')} />}
      {m === 'dep' && <DepForm onClose={() => setM('')} />}
      {sel && <AssetDetail a={sel} onClose={() => setSel(null)} />}
    </>
  );
}
function AssetForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const { settings } = useAuth();
  const [f, setF] = useState({ name: '', categoryId: settings.lists.assetCategories[0]?.id || '', purchaseDate: today(), cost: '', currency: settings.finance.baseCurrency, rate: '', location: '', responsible: '', usefulLifeMonths: '', residualValue: '', inServiceDate: '', notes: '' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal open onClose={onClose} title="تسجيل أصل قائم (رصيد افتتاحي)" wide onSubmit={async () => {
      const r = await api('assets.create', { ...f, cost: Number(f.cost), rate: num(f.rate), usefulLifeMonths: num(f.usefulLifeMonths), residualValue: num(f.residualValue), inServiceDate: f.inServiceDate || undefined }); toast(`تم تسجيل الأصل ${r.code}`);
    }}>
      <Grid cols={3}>
        <Field label="الاسم" required><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="الفئة"><Select value={f.categoryId} onChange={set('categoryId')} options={settings.lists.assetCategories.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="تاريخ الشراء" required><Input type="date" value={f.purchaseDate} onChange={set('purchaseDate')} /></Field>
        <Field label="تكلفة الاقتناء (ريال)" required><Input type="number" value={f.cost} onChange={set('cost')} /></Field>
        <Field label="الموقع"><Input value={f.location} onChange={set('location')} /></Field>
        <Field label="المسؤول"><Input value={f.responsible} onChange={set('responsible')} /></Field>
        <Field label="العمر الإنتاجي (أشهر)" hint="فارغ = بلا إهلاك"><Input type="number" value={f.usefulLifeMonths} onChange={set('usefulLifeMonths')} /></Field>
        <Field label="القيمة المتبقية"><Input type="number" value={f.residualValue} onChange={set('residualValue')} /></Field>
        <Field label="تاريخ بدء الخدمة"><Input type="date" value={f.inServiceDate} onChange={set('inServiceDate')} /></Field>
      </Grid>
    </FormModal>
  );
}
function DepForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const [month, setMonth] = useState(today().slice(0, 7));
  return (
    <FormModal open onClose={onClose} title="احتساب الإهلاك الشهري (قسط ثابت)" submitLabel="احتساب وترحيل" onSubmit={async () => {
      const r = await api('assets.runDepreciation', { month });
      toast(`تم ترحيل إهلاك ${r.assets} أصل بإجمالي ${(r.totalMinor / 100).toLocaleString('en-US')} ريال${r.skipped.length ? ` — تم تخطي ${r.skipped.length} أصل بلا سياسة` : ''}`, r.skipped.length ? 'warn' : 'ok');
    }}>
      <Note>يُحتسب فقط للأصول التي حُدد لها عمر إنتاجي وقيمة متبقية. العملية آمنة للتكرار: لا يُحتسب نفس الشهر مرتين لنفس الأصل.</Note>
      <Field label="الشهر" required><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
    </FormModal>
  );
}
function AssetDetail({ a, onClose }: { a: any; onClose: () => void }) {
  const { can } = useAuth(); const toast = useToast();
  const [f, setF] = useState({ location: a.location || '', responsible: a.responsible || '', status: a.status, usefulLifeMonths: a.usefulLifeMonths ? String(a.usefulLifeMonths) : '', residualValue: a.residualMinor != null ? String(a.residualMinor / 100) : '', inServiceDate: a.inServiceDate || '' });
  return (
    <Modal open onClose={onClose} title={`${a.code} — ${a.name}`} wide footer={<>{can('assets', 'edit') && <Button variant="primary" onClick={async () => {
      try { await api('assets.update', { id: a.id, location: f.location, responsible: f.responsible, status: f.status, usefulLifeMonths: num(f.usefulLifeMonths), residualValue: num(f.residualValue), inServiceDate: f.inServiceDate || undefined }); toast('تم الحفظ'); onClose(); } catch (e: any) { toast(e.message, 'bad'); }
    }}>حفظ</Button>}<Button onClick={onClose}>إغلاق</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><Stat label="التكلفة" value={<Money v={a.costMinor} />} /><Stat label="مجمع الإهلاك" value={<Money v={a.accumulatedDepMinor} />} /><Stat label="القيمة الدفترية" value={<Money v={a.costMinor - a.accumulatedDepMinor} />} />
          <Stat label="تكاليف الصيانة" value={<Money v={a.maintenanceMinor} />} /><Stat label="تاريخ الشراء" value={formatDate(a.purchaseDate)} /><Stat label="المصدر" value={a.source === 'purchase' ? 'فاتورة مشتريات' : 'رصيد افتتاحي'} /></Card>
        <div className="space-y-3">
          <Grid><Field label="الموقع"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field><Field label="المسؤول"><Input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field>
            <Field label="الحالة"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'in_service', label: 'في الخدمة' }, { value: 'maintenance', label: 'صيانة' }, { value: 'retired', label: 'خارج الخدمة' }]} /></Field>
            <Field label="بدء الخدمة"><Input type="date" value={f.inServiceDate} onChange={(e) => setF({ ...f, inServiceDate: e.target.value })} /></Field>
            <Field label="العمر الإنتاجي (أشهر)"><Input type="number" value={f.usefulLifeMonths} onChange={(e) => setF({ ...f, usefulLifeMonths: e.target.value })} /></Field>
            <Field label="القيمة المتبقية"><Input type="number" value={f.residualValue} onChange={(e) => setF({ ...f, residualValue: e.target.value })} /></Field></Grid>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><Documents module="assets" recordId={a.id} /><Card title="السجل"><History recordId={a.id} /></Card></div>
    </Modal>
  );
}
