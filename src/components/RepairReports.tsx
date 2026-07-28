import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Repair, RepairStatus, StoreSettings, UserProfile, REPAIR_STATUS_LABELS } from '../types';
import {
  BarChart3, Download, Wrench, TrendingUp, DollarSign, Clock, CheckCircle,
  Smartphone, User, AlertCircle, Calendar
} from 'lucide-react';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';

interface Props {
  userProfile: UserProfile | null;
}

type Period = 'all' | '7d' | '30d' | '90d' | 'year';

const PERIOD_LABELS: Record<Period, string> = {
  all: 'Tout', '7d': '7 jours', '30d': '30 jours', '90d': '90 jours', year: 'Cette année',
};

const STATUS_COLORS: Record<RepairStatus, string> = {
  recu: 'bg-slate-400',
  diagnostic: 'bg-blue-500',
  en_attente_piece: 'bg-amber-500',
  en_cours: 'bg-indigo-500',
  termine: 'bg-emerald-500',
  livre: 'bg-teal-500',
  irreparable: 'bg-rose-500',
  annule: 'bg-slate-300',
};

export default function RepairReports({ userProfile }: Props) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'repairs'), where('ownerId', '==', ownerId)),
      (snap) => {
        setRepairs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Repair)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    const unsubS = onSnapshot(doc(db, 'settings', ownerId), (snap) => {
      if (snap.exists()) setSettings({ id: snap.id, ...snap.data() } as StoreSettings);
    });
    return () => { unsub(); unsubS(); };
  }, [ownerId]);

  const currency = settings?.currency || 'DT';

  const periodStart = useMemo(() => {
    const now = new Date();
    switch (period) {
      case '7d': return new Date(now.getTime() - 7 * 864e5);
      case '30d': return new Date(now.getTime() - 30 * 864e5);
      case '90d': return new Date(now.getTime() - 90 * 864e5);
      case 'year': return new Date(now.getFullYear(), 0, 1);
      default: return new Date(0);
    }
  }, [period]);

  const getDate = (r: Repair): Date => {
    try { return r.date?.toDate ? r.date.toDate() : new Date(0); } catch { return new Date(0); }
  };

  const filtered = useMemo(
    () => repairs.filter(r => getDate(r) >= periodStart),
    [repairs, periodStart]
  );

  const stats = useMemo(() => {
    const total = filtered.length;
    const revenue = filtered.reduce((s, r) => s + (r.paid || 0), 0);
    const invoiced = filtered.reduce((s, r) => s + (r.total || 0), 0);
    const outstanding = filtered.reduce((s, r) => s + (r.debt || 0), 0);
    const partsCost = filtered.reduce((s, r) =>
      s + (r.parts || []).reduce((ps, p) => ps + p.unitBuyPrice * p.quantity, 0), 0);
    const laborRevenue = filtered.reduce((s, r) => s + (r.laborCost || 0), 0);
    const partsRevenue = filtered.reduce((s, r) =>
      s + (r.parts || []).reduce((ps, p) => ps + p.total, 0), 0);
    const grossProfit = invoiced - partsCost;
    const delivered = filtered.filter(r => r.status === 'livre').length;
    const irreparable = filtered.filter(r => r.status === 'irreparable').length;

    // Répartition par statut
    const byStatus: Record<string, number> = {};
    filtered.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

    // Top techniciens
    const techMap: Record<string, { count: number; revenue: number }> = {};
    filtered.forEach(r => {
      const t = (r.technician || '').trim() || 'Non assigné';
      if (!techMap[t]) techMap[t] = { count: 0, revenue: 0 };
      techMap[t].count++;
      techMap[t].revenue += r.total || 0;
    });
    const topTechs = Object.entries(techMap)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count).slice(0, 5);

    // Top appareils (marque+modèle)
    const devMap: Record<string, number> = {};
    filtered.forEach(r => {
      const d = [r.deviceBrand, r.deviceModel].filter(Boolean).join(' ').trim() || 'Inconnu';
      devMap[d] = (devMap[d] || 0) + 1;
    });
    const topDevices = Object.entries(devMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 5);

    return {
      total, revenue, invoiced, outstanding, partsCost, laborRevenue,
      partsRevenue, grossProfit, delivered, irreparable, byStatus, topTechs, topDevices
    };
  }, [filtered]);

  const exportExcel = () => {
    const rows = filtered.map(r => ({
      'N°': r.number,
      'Date': getDate(r).toLocaleDateString('fr-FR'),
      'Client': r.clientName || '',
      'Téléphone': r.clientPhone || '',
      'Marque': r.deviceBrand || '',
      'Modèle': r.deviceModel || '',
      'IMEI': r.imei || '',
      'Panne': r.problem || '',
      'Diagnostic': r.diagnostic || '',
      'Technicien': r.technician || '',
      'Statut': REPAIR_STATUS_LABELS[r.status],
      'Main d\'œuvre': r.laborCost || 0,
      'Pièces': (r.parts || []).reduce((s, p) => s + p.total, 0),
      'Total': r.total || 0,
      'Payé': r.paid || 0,
      'Reste dû': r.debt || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Réparations');
    XLSX.writeFile(wb, `rapport-reparations-${period}-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const maxStatus = Math.max(1, ...Object.values(stats.byStatus));

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black font-display text-slate-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <BarChart3 className="w-6 h-6 text-white" />
            </span>
            Rapports atelier
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Statistiques et performance des réparations</p>
        </div>
        <button onClick={exportExcel}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all">
          <Download className="w-5 h-5" /> Exporter Excel
        </button>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all border",
              period === p ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20"
                : "bg-white text-slate-500 border-slate-200 hover:border-indigo-200")}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Réparations', value: stats.total, icon: Wrench, color: 'from-indigo-500 to-indigo-600' },
          { label: 'Encaissé', value: `${stats.revenue.toFixed(2)} ${currency}`, icon: DollarSign, color: 'from-emerald-500 to-emerald-600' },
          { label: 'Bénéfice brut', value: `${stats.grossProfit.toFixed(2)} ${currency}`, icon: TrendingUp, color: 'from-cyan-500 to-cyan-600' },
          { label: 'Impayés', value: `${stats.outstanding.toFixed(2)} ${currency}`, icon: AlertCircle, color: 'from-rose-500 to-rose-600' },
        ].map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={i} className={cn("rounded-2xl p-4 text-white bg-gradient-to-br shadow-lg", c.color)}>
              <Icon className="w-6 h-6 mb-2 opacity-90" />
              <p className="text-2xl font-black font-display">{c.value}</p>
              <p className="text-[11px] font-bold uppercase tracking-wider opacity-90 mt-0.5">{c.label}</p>
            </div>
          );
        })}
      </div>

      {/* Breakdown revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">Décomposition du CA</p>
          <div className="space-y-3">
            <RevRow label="Main d'œuvre" value={stats.laborRevenue} currency={currency} />
            <RevRow label="Pièces (facturées)" value={stats.partsRevenue} currency={currency} />
            <RevRow label="Coût des pièces" value={-stats.partsCost} currency={currency} muted />
            <div className="border-t border-slate-100 pt-3">
              <RevRow label="Total facturé" value={stats.invoiced} currency={currency} bold />
            </div>
          </div>
        </div>

        {/* Status distribution */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm lg:col-span-2">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">Répartition par statut</p>
          <div className="space-y-2.5">
            {(Object.keys(REPAIR_STATUS_LABELS) as RepairStatus[]).filter(s => stats.byStatus[s]).map(s => (
              <div key={s} className="flex items-center gap-3">
                <span className="w-28 text-xs font-bold text-slate-600 shrink-0">{REPAIR_STATUS_LABELS[s]}</span>
                <div className="flex-1 h-6 bg-slate-50 rounded-lg overflow-hidden">
                  <div className={cn("h-full rounded-lg flex items-center justify-end px-2", STATUS_COLORS[s])}
                    style={{ width: `${(stats.byStatus[s] / maxStatus) * 100}%`, minWidth: '2rem' }}>
                    <span className="text-[10px] font-black text-white">{stats.byStatus[s]}</span>
                  </div>
                </div>
              </div>
            ))}
            {stats.total === 0 && <p className="text-sm text-slate-400 text-center py-4">Aucune réparation sur cette période</p>}
          </div>
        </div>
      </div>

      {/* Top lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Techniciens</p>
          <div className="space-y-2">
            {stats.topTechs.length === 0 ? <p className="text-sm text-slate-400">—</p> : stats.topTechs.map((t, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2.5">
                <span className="font-bold text-sm text-slate-700">{t.name}</span>
                <div className="text-right">
                  <span className="text-sm font-black text-slate-800">{t.count}</span>
                  <span className="text-xs text-slate-400 ml-1">rép. · {t.revenue.toFixed(0)} {currency}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> Appareils les plus réparés</p>
          <div className="space-y-2">
            {stats.topDevices.length === 0 ? <p className="text-sm text-slate-400">—</p> : stats.topDevices.map((d, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2.5">
                <span className="font-bold text-sm text-slate-700 truncate">{d.name}</span>
                <span className="text-sm font-black text-indigo-600 shrink-0 ml-2">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Delivered / irreparable summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 flex items-center justify-center"><CheckCircle className="w-6 h-6 text-teal-500" /></div>
          <div>
            <p className="text-2xl font-black text-slate-900 font-display">{stats.delivered}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Appareils livrés</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center"><AlertCircle className="w-6 h-6 text-rose-500" /></div>
          <div>
            <p className="text-2xl font-black text-slate-900 font-display">{stats.irreparable}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Irréparables</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RevRow({ label, value, currency, bold, muted }: { label: string; value: number; currency: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-sm", bold ? "font-black text-slate-800" : muted ? "text-slate-400" : "font-semibold text-slate-600")}>{label}</span>
      <span className={cn("text-sm", bold ? "font-black text-indigo-600" : muted ? "text-slate-400" : "font-bold text-slate-800")}>
        {value.toFixed(2)} {currency}
      </span>
    </div>
  );
}
