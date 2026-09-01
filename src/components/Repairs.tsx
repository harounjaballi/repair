import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, query, where,
  serverTimestamp, runTransaction, getDoc, deleteDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Repair, RepairStatus, RepairPart, RepairLog, Client, Product,
  StoreSettings, UserProfile, REPAIR_STATUS_LABELS
} from '../types';
import { handleFirestoreError, OperationType } from '../App';
import {
  Wrench, Plus, Search, X, Smartphone, User, Clock, CheckCircle,
  AlertCircle, Trash2, Package, Shield, FileText, Edit3, Phone,
  Calendar, ChevronRight, History, DollarSign, Filter
} from 'lucide-react';
import { cn, isSparePart } from '../lib/utils';
import { format } from 'date-fns';
import { RepairTicket } from './RepairTicket';

interface RepairsProps {
  userProfile: UserProfile | null;
}

const STATUS_STYLES: Record<RepairStatus, string> = {
  recu: 'bg-slate-100 text-slate-700 border-slate-200',
  diagnostic: 'bg-blue-50 text-blue-700 border-blue-200',
  en_attente_piece: 'bg-amber-50 text-amber-700 border-amber-200',
  en_cours: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  termine: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  livre: 'bg-teal-50 text-teal-700 border-teal-200',
  irreparable: 'bg-rose-50 text-rose-700 border-rose-200',
  annule: 'bg-slate-100 text-slate-400 border-slate-200 line-through',
};

const ACTIVE_STATUSES: RepairStatus[] = ['recu', 'diagnostic', 'en_attente_piece', 'en_cours', 'termine'];

export default function Repairs({ userProfile }: RepairsProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
  const currentUserLabel = userProfile?.name || userProfile?.email || 'Utilisateur';

  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | RepairStatus>('active');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRepair, setEditingRepair] = useState<Repair | null>(null);
  const [detailRepair, setDetailRepair] = useState<Repair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ---- Data listeners ----
  useEffect(() => {
    const unsubRepairs = onSnapshot(
      query(collection(db, 'repairs'), where('ownerId', '==', ownerId)),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Repair));
        list.sort((a, b) => {
          const da = a.date?.toMillis ? a.date.toMillis() : 0;
          const dbb = b.date?.toMillis ? b.date.toMillis() : 0;
          return dbb - da;
        });
        setRepairs(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'repairs')
    );
    const unsubClients = onSnapshot(
      query(collection(db, 'clients'), where('ownerId', '==', ownerId)),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setClients(list);
      }
    );
    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), where('ownerId', '==', ownerId)),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setProducts(list);
      }
    );
    const unsubSettings = onSnapshot(doc(db, 'settings', ownerId), (snap) => {
      if (snap.exists()) setSettings({ id: snap.id, ...snap.data() } as StoreSettings);
    });
    return () => { unsubRepairs(); unsubClients(); unsubProducts(); unsubSettings(); };
  }, [ownerId]);

  const currency = settings?.currency || 'DT';

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 3500); return () => clearTimeout(t); }
  }, [success]);
  useEffect(() => {
    if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); }
  }, [error]);

  // ---- Filtering ----
  const filtered = useMemo(() => {
    return repairs.filter(r => {
      const matchSearch = !searchTerm ||
        (r.number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.clientPhone || '').includes(searchTerm) ||
        (r.deviceModel || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.imei || '').includes(searchTerm);
      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'active' ? ACTIVE_STATUSES.includes(r.status) :
        r.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [repairs, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    const active = repairs.filter(r => ACTIVE_STATUSES.includes(r.status)).length;
    const ready = repairs.filter(r => r.status === 'termine').length;
    const waitingParts = repairs.filter(r => r.status === 'en_attente_piece').length;
    const unpaid = repairs.reduce((s, r) => s + (r.debt || 0), 0);
    return { active, ready, waitingParts, unpaid };
  }, [repairs]);

  // ---- Generate next repair number (transactional counter) ----
  const generateRepairNumber = async (): Promise<string> => {
    const year = new Date().getFullYear();
    const counterRef = doc(db, 'counters', `repairs_${ownerId}`);
    let num = 1;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      num = (snap.exists() ? (snap.data().lastNum || 0) : 0) + 1;
      tx.set(counterRef, { lastNum: num }, { merge: true });
    });
    return `REP-${year}-${num.toString().padStart(4, '0')}`;
  };

  const handleDelete = async (r: Repair) => {
    if (userProfile?.role !== 'admin') { setError("Seul un administrateur peut supprimer une réparation."); return; }
    if (!window.confirm(`Supprimer la réparation ${r.number} ? Les pièces utilisées seront restituées au stock.`)) return;
    try {
      await runTransaction(db, async (tx) => {
        // Restituer le stock des pièces
        for (const p of (r.parts || [])) {
          const prodRef = doc(db, 'products', p.productId);
          const prodSnap = await tx.get(prodRef);
          if (prodSnap.exists()) {
            const cur = prodSnap.data().stock || 0;
            tx.update(prodRef, { stock: cur + p.quantity });
          }
        }
        tx.delete(doc(db, 'repairs', r.id));
      });
      setSuccess(`Réparation ${r.number} supprimée, stock restitué.`);
      setDetailRepair(null);
    } catch (e: any) {
      setError("Échec de la suppression : " + (e.message || e));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black font-display text-slate-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Wrench className="w-6 h-6 text-white" />
            </span>
            Atelier de réparation
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Gestion des ordres de réparation et suivi</p>
        </div>
        <button
          onClick={() => { setEditingRepair(null); setIsFormOpen(true); }}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-indigo-600/20 transition-all"
        >
          <Plus className="w-5 h-5" /> Nouvelle réparation
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'En cours', value: stats.active, icon: Clock, color: 'from-indigo-500 to-indigo-600' },
          { label: 'Prêts à récupérer', value: stats.ready, icon: CheckCircle, color: 'from-emerald-500 to-emerald-600' },
          { label: 'Attente pièces', value: stats.waitingParts, icon: Package, color: 'from-amber-500 to-amber-600' },
          { label: 'Impayés', value: `${stats.unpaid.toFixed(2)} ${currency}`, icon: DollarSign, color: 'from-rose-500 to-rose-600' },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-tr flex items-center justify-center mb-3", s.color)}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-2xl font-black text-slate-900 font-display">{s.value}</p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Notifications */}
      {success && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm font-semibold">
          <CheckCircle className="w-4 h-4" /> {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-semibold">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher : n°, client, téléphone, modèle, IMEI..."
            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="pl-11 pr-8 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none cursor-pointer"
          >
            <option value="active">En cours (actifs)</option>
            <option value="all">Tous les statuts</option>
            {Object.entries(REPAIR_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
            <Wrench className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">Aucune réparation trouvée</p>
          </div>
        ) : filtered.map(r => (
          <div
            key={r.id}
            onClick={() => setDetailRepair(r)}
            className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-indigo-50 transition-colors">
                <Smartphone className="w-6 h-6 text-slate-400 group-hover:text-indigo-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-black text-sm text-indigo-600">{r.number}</span>
                  <span className={cn("px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border", STATUS_STYLES[r.status])}>
                    {REPAIR_STATUS_LABELS[r.status]}
                  </span>
                  {r.warrantyUntil && new Date(r.warrantyUntil) > new Date() && (
                    <span className="flex items-center gap-1 text-[10px] font-black text-teal-600"><Shield className="w-3 h-3" /> Garantie</span>
                  )}
                </div>
                <p className="text-sm font-bold text-slate-800 truncate mt-0.5">
                  {r.deviceBrand} {r.deviceModel} — <span className="text-slate-500 font-medium">{r.problem}</span>
                </p>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 font-medium">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" /> {r.clientName || 'Sans client'}</span>
                  {r.date?.toDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(r.date.toDate(), 'dd/MM/yyyy')}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-black text-slate-900">{(r.total || 0).toFixed(2)} {currency}</p>
                {r.debt > 0 && <p className="text-[11px] font-bold text-rose-500">Reste {r.debt.toFixed(2)}</p>}
                <ChevronRight className="w-4 h-4 text-slate-300 ml-auto mt-1 group-hover:text-indigo-400 transition-colors" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Form modal */}
      {isFormOpen && (
        <RepairForm
          repair={editingRepair}
          clients={clients}
          products={products}
          settings={settings}
          currency={currency}
          ownerId={ownerId}
          currentUserLabel={currentUserLabel}
          generateRepairNumber={generateRepairNumber}
          onClose={() => setIsFormOpen(false)}
          onSaved={(msg) => { setSuccess(msg); setIsFormOpen(false); }}
          onError={setError}
        />
      )}

      {/* Detail modal */}
      {detailRepair && (
        <RepairDetail
          repair={repairs.find(r => r.id === detailRepair.id) || detailRepair}
          currency={currency}
          canDelete={userProfile?.role === 'admin'}
          currentUserLabel={currentUserLabel}
          settings={settings}
          ownerId={ownerId}
          clients={clients}
          onEdit={() => { setEditingRepair(detailRepair); setDetailRepair(null); setIsFormOpen(true); }}
          onClose={() => setDetailRepair(null)}
          onDelete={() => handleDelete(detailRepair)}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}
    </div>
  );
}

// ============================================================
//  FORMULAIRE DE RÉPARATION
// ============================================================
function RepairForm({
  repair, clients, products, settings, currency, ownerId, currentUserLabel,
  generateRepairNumber, onClose, onSaved, onError
}: {
  repair: Repair | null;
  clients: Client[];
  products: Product[];
  settings: StoreSettings | null;
  currency: string;
  ownerId: string;
  currentUserLabel: string;
  generateRepairNumber: () => Promise<string>;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!repair;
  const [clientId, setClientId] = useState(repair?.clientId || '');
  const [clientSearch, setClientSearch] = useState('');
  const [deviceBrand, setDeviceBrand] = useState(repair?.deviceBrand || '');
  const [deviceModel, setDeviceModel] = useState(repair?.deviceModel || '');
  const [imei, setImei] = useState(repair?.imei || '');
  const [devicePassword, setDevicePassword] = useState(repair?.devicePassword || '');
  const [accessories, setAccessories] = useState(repair?.accessories || '');
  const [deviceCondition, setDeviceCondition] = useState(repair?.deviceCondition || '');
  const [problem, setProblem] = useState(repair?.problem || '');
  const [diagnostic, setDiagnostic] = useState(repair?.diagnostic || '');
  const [technician, setTechnician] = useState(repair?.technician || '');
  const [status, setStatus] = useState<RepairStatus>(repair?.status || 'recu');
  const [estimatedCost, setEstimatedCost] = useState(repair?.estimatedCost?.toString() || '');
  const [laborCost, setLaborCost] = useState(repair?.laborCost?.toString() || '');
  const [parts, setParts] = useState<RepairPart[]>(repair?.parts || []);
  const [paid, setPaid] = useState(repair?.paid?.toString() || '');
  const [warrantyDays, setWarrantyDays] = useState(
    repair?.warrantyDays?.toString() || settings?.defaultWarrantyDays?.toString() || '30'
  );
  const [partSearch, setPartSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedClient = clients.find(c => c.id === clientId);
  const filteredClients = clients.filter(c =>
    !clientSearch ||
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.phone || '').includes(clientSearch)
  ).slice(0, 6);

  const partProducts = products.filter(p =>
    isSparePart(p) && partSearch && (
      p.name.toLowerCase().includes(partSearch.toLowerCase()) ||
      (p.reference || '').toLowerCase().includes(partSearch.toLowerCase()) ||
      (p.barcode || '').includes(partSearch)
    )
  ).slice(0, 6);

  const partsTotal = parts.reduce((s, p) => s + p.total, 0);
  const total = (parseFloat(laborCost) || 0) + partsTotal;
  const debt = Math.max(0, total - (parseFloat(paid) || 0));

  const addPart = (p: Product) => {
    const existing = parts.find(x => x.productId === p.id);
    if (existing) {
      setParts(parts.map(x => x.productId === p.id
        ? { ...x, quantity: x.quantity + 1, total: (x.quantity + 1) * x.unitPrice }
        : x));
    } else {
      setParts([...parts, {
        productId: p.id, name: p.name, quantity: 1,
        unitBuyPrice: p.buyPrice, unitPrice: p.sellPrice, total: p.sellPrice
      }]);
    }
    setPartSearch('');
  };

  const updatePartQty = (id: string, qty: number) => {
    if (qty <= 0) { setParts(parts.filter(p => p.productId !== id)); return; }
    setParts(parts.map(p => p.productId === id ? { ...p, quantity: qty, total: qty * p.unitPrice } : p));
  };
  const updatePartPrice = (id: string, price: number) => {
    setParts(parts.map(p => p.productId === id ? { ...p, unitPrice: price, total: p.quantity * price } : p));
  };

  const handleSubmit = async () => {
    if (!problem.trim()) { onError("Décrivez la panne signalée."); return; }
    if (!deviceModel.trim() && !deviceBrand.trim()) { onError("Indiquez au moins la marque ou le modèle."); return; }
    setSaving(true);
    try {
      const client = clients.find(c => c.id === clientId);
      const now = new Date().toISOString();

      // Détecter changement de statut pour l'historique
      const statusChanged = !isEdit || repair?.status !== status;
      const prevParts = repair?.parts || [];

      // Calcul garantie si livré
      let warrantyUntil = repair?.warrantyUntil;
      let deliveredAt = repair?.deliveredAt;
      if (status === 'livre' && repair?.status !== 'livre') {
        deliveredAt = now;
        const days = parseInt(warrantyDays) || 0;
        if (days > 0) {
          const d = new Date();
          d.setDate(d.getDate() + days);
          warrantyUntil = d.toISOString();
        }
      }

      const newLog: RepairLog = {
        date: now,
        note: isEdit
          ? (statusChanged ? `Statut → ${REPAIR_STATUS_LABELS[status]}` : 'Modification de la fiche')
          : 'Réparation créée',
        by: currentUserLabel,
      };
      // On n'ajoute le champ status au log que s'il a changé (Firestore refuse undefined).
      if (statusChanged) {
        newLog.status = status;
      }
      // Nettoyage défensif : purge toute valeur undefined des anciens logs
      // (des fiches créées avant ce correctif pouvaient contenir status: undefined,
      // ce que Firestore refuse lors de l'update).
      const cleanLogs = [...(repair?.logs || []), newLog].map(l => {
        const clean: RepairLog = { date: l.date, note: l.note };
        if (l.status !== undefined) clean.status = l.status;
        if (l.by !== undefined) clean.by = l.by;
        return clean;
      });
      const logs = cleanLogs;

      const payload: any = {
        clientId: clientId || '',
        clientName: client?.name || '',
        clientPhone: client?.phone || '',
        deviceBrand: deviceBrand.trim(),
        deviceModel: deviceModel.trim(),
        imei: imei.trim(),
        devicePassword: devicePassword.trim(),
        accessories: accessories.trim(),
        deviceCondition: deviceCondition.trim(),
        problem: problem.trim(),
        diagnostic: diagnostic.trim(),
        status,
        technician: technician.trim(),
        estimatedCost: parseFloat(estimatedCost) || 0,
        laborCost: parseFloat(laborCost) || 0,
        parts,
        total,
        paid: parseFloat(paid) || 0,
        debt,
        warrantyDays: parseInt(warrantyDays) || 0,
        warrantyUntil: warrantyUntil || null,
        deliveredAt: deliveredAt || null,
        logs,
        ownerId,
      };

      if (isEdit && repair) {
        // Ajustement du stock des pièces (différentiel) via transaction
        await runTransaction(db, async (tx) => {
          const repairRef = doc(db, 'repairs', repair.id);
          // Calcul du delta par pièce
          const deltas: Record<string, number> = {};
          for (const p of prevParts) deltas[p.productId] = (deltas[p.productId] || 0) + p.quantity; // remis
          for (const p of parts) deltas[p.productId] = (deltas[p.productId] || 0) - p.quantity;      // repris
          // Lire tous les produits concernés
          const refs: Record<string, any> = {};
          const snaps: Record<string, any> = {};
          for (const pid of Object.keys(deltas)) {
            refs[pid] = doc(db, 'products', pid);
            snaps[pid] = await tx.get(refs[pid]);
          }
          for (const pid of Object.keys(deltas)) {
            if (deltas[pid] !== 0 && snaps[pid].exists()) {
              const cur = snaps[pid].data().stock || 0;
              tx.update(refs[pid], { stock: cur + deltas[pid] });
            }
          }
          tx.update(repairRef, payload);
        });
        onSaved(`Réparation ${repair.number} mise à jour.`);
      } else {
        const number = await generateRepairNumber();
        // Créer + déduire le stock des pièces
        await runTransaction(db, async (tx) => {
          const refs: Record<string, any> = {};
          const snaps: Record<string, any> = {};
          for (const p of parts) {
            refs[p.productId] = doc(db, 'products', p.productId);
            snaps[p.productId] = await tx.get(refs[p.productId]);
          }
          for (const p of parts) {
            if (snaps[p.productId]?.exists()) {
              const cur = snaps[p.productId].data().stock || 0;
              tx.update(refs[p.productId], { stock: cur - p.quantity });
            }
          }
          const repairRef = doc(collection(db, 'repairs'));
          tx.set(repairRef, { ...payload, number, date: serverTimestamp() });
        });
        onSaved(`Réparation ${number} créée.`);
      }
    } catch (e: any) {
      onError("Erreur d'enregistrement : " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white rounded-t-3xl z-10">
          <h2 className="text-lg font-black font-display text-slate-900 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-indigo-600" />
            {isEdit ? `Modifier ${repair?.number}` : 'Nouvelle réparation'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Client */}
          <section>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Client</label>
            {selectedClient ? (
              <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-indigo-500" />
                  <span className="font-bold text-sm text-slate-800">{selectedClient.name}</span>
                  {selectedClient.phone && <span className="text-xs text-slate-500">· {selectedClient.phone}</span>}
                </div>
                <button onClick={() => { setClientId(''); setClientSearch(''); }} className="text-xs font-bold text-rose-500">Retirer</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Rechercher un client (nom, téléphone)... — optionnel"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                {clientSearch && filteredClients.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-100 rounded-xl shadow-lg overflow-hidden">
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => { setClientId(c.id); setClientSearch(''); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 text-sm border-b border-slate-50 last:border-0">
                        <span className="font-bold text-slate-800">{c.name}</span>
                        {c.phone && <span className="text-xs text-slate-400 ml-2">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Appareil */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="Marque" value={deviceBrand} onChange={setDeviceBrand} placeholder="Samsung, Apple..." />
            <Field label="Modèle" value={deviceModel} onChange={setDeviceModel} placeholder="Galaxy S21, iPhone 12..." />
            <Field label="IMEI / N° série" value={imei} onChange={setImei} placeholder="Optionnel" />
            <Field label="Code déverrouillage" value={devicePassword} onChange={setDevicePassword} placeholder="Confié par le client" />
            <Field label="Accessoires déposés" value={accessories} onChange={setAccessories} placeholder="Chargeur, coque..." full />
            <Field label="État à la réception" value={deviceCondition} onChange={setDeviceCondition} placeholder="Rayures, écran fissuré..." full />
          </section>

          {/* Panne */}
          <section className="space-y-3">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Panne signalée *</label>
              <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={2}
                placeholder="Décrivez le problème rapporté par le client"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Diagnostic technicien</label>
              <textarea value={diagnostic} onChange={(e) => setDiagnostic(e.target.value)} rows={2}
                placeholder="Diagnostic après examen"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <Field label="Technicien assigné" value={technician} onChange={setTechnician} placeholder="Nom du technicien" />
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Statut</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as RepairStatus)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                {Object.entries(REPAIR_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </section>

          {/* Pièces utilisées */}
          <section>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" /> Pièces utilisées (déduites du stock)
            </label>
            <div className="relative mb-2">
              <input value={partSearch} onChange={(e) => setPartSearch(e.target.value)}
                placeholder="Ajouter une pièce (nom, référence, code-barres)..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              {partProducts.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-100 rounded-xl shadow-lg overflow-hidden">
                  {partProducts.map(p => (
                    <button key={p.id} onClick={() => addPart(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 text-sm border-b border-slate-50 last:border-0 flex justify-between">
                      <span className="font-bold text-slate-800">{p.name}</span>
                      <span className="text-xs text-slate-400">Stock {p.stock} · {p.sellPrice.toFixed(2)} {currency}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {parts.length > 0 && (
              <div className="space-y-2">
                {parts.map(p => (
                  <div key={p.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                    <span className="flex-1 text-sm font-semibold text-slate-700 truncate">{p.name}</span>
                    <input type="number" value={p.quantity} min={1}
                      onChange={(e) => updatePartQty(p.productId, parseInt(e.target.value) || 0)}
                      className="w-14 px-2 py-1 bg-white border border-slate-200 rounded-lg text-sm text-center" />
                    <span className="text-slate-300">×</span>
                    <input type="number" value={p.unitPrice} step="0.01"
                      onChange={(e) => updatePartPrice(p.productId, parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 bg-white border border-slate-200 rounded-lg text-sm text-right" />
                    <span className="w-20 text-right text-sm font-black text-slate-800">{p.total.toFixed(2)}</span>
                    <button onClick={() => updatePartQty(p.productId, 0)} className="text-rose-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Coûts */}
          <section className="grid grid-cols-2 gap-3 bg-slate-50 rounded-2xl p-4">
            <Field label="Devis estimé" value={estimatedCost} onChange={setEstimatedCost} type="number" placeholder="0" />
            <Field label="Main d'œuvre" value={laborCost} onChange={setLaborCost} type="number" placeholder="0" />
            <div className="col-span-2 flex items-center justify-between text-sm border-t border-slate-200 pt-3">
              <span className="text-slate-500 font-semibold">Total pièces</span>
              <span className="font-black text-slate-700">{partsTotal.toFixed(2)} {currency}</span>
            </div>
            <div className="col-span-2 flex items-center justify-between">
              <span className="text-slate-800 font-black">TOTAL</span>
              <span className="font-black text-lg text-indigo-600">{total.toFixed(2)} {currency}</span>
            </div>
            <Field label="Payé / acompte" value={paid} onChange={setPaid} type="number" placeholder="0" />
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Reste dû</label>
              <div className={cn("px-4 py-2.5 rounded-xl text-sm font-black", debt > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600")}>
                {debt.toFixed(2)} {currency}
              </div>
            </div>
            <Field label="Garantie (jours)" value={warrantyDays} onChange={setWarrantyDays} type="number" placeholder="30" />
          </section>
        </div>

        <div className="flex gap-3 p-5 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-3xl">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">Annuler</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-600/20">
            {saving ? 'Enregistrement...' : (isEdit ? 'Enregistrer' : 'Créer la réparation')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', full = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
    </div>
  );
}

// ============================================================
//  DÉTAIL RÉPARATION + suivi + changement rapide de statut
// ============================================================
function RepairDetail({
  repair, currency, canDelete, currentUserLabel, settings, ownerId, clients,
  onEdit, onClose, onDelete, onError, onSuccess
}: {
  repair: Repair;
  currency: string;
  canDelete: boolean;
  currentUserLabel: string;
  settings: StoreSettings | null;
  ownerId: string;
  clients: Client[];
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
  onError: (m: string) => void;
  onSuccess: (m: string) => void;
}) {
  const [quickNote, setQuickNote] = useState('');
  const [updating, setUpdating] = useState(false);
  const [showDeliveryCaisse, setShowDeliveryCaisse] = useState(false);

  const repairClient = clients.find(c => c.id === repair.clientId) || null;

  const changeStatus = async (newStatus: RepairStatus) => {
    if (newStatus === repair.status && !quickNote.trim()) return;
    // La livraison passe systématiquement par la caisse (encaissement/remise/crédit).
    if (newStatus === 'livre' && repair.status !== 'livre') {
      setShowDeliveryCaisse(true);
      return;
    }
    setUpdating(true);
    try {
      const now = new Date().toISOString();
      const log: RepairLog = {
        date: now,
        status: newStatus !== repair.status ? newStatus : undefined,
        note: quickNote.trim() || `Statut → ${REPAIR_STATUS_LABELS[newStatus]}`,
        by: currentUserLabel,
      };
      await updateDoc(doc(db, 'repairs', repair.id), {
        status: newStatus,
        logs: [...(repair.logs || []), log],
      });
      setQuickNote('');
      onSuccess(`Statut mis à jour : ${REPAIR_STATUS_LABELS[newStatus]}`);
    } catch (e: any) {
      onError("Échec de la mise à jour : " + (e.message || e));
    } finally { setUpdating(false); }
  };

  // Confirmation de la livraison depuis la fenêtre de caisse : encaissement + remise,
  // avec possibilité de créditer le reste au compte du client au lieu de le garder comme
  // dette sur la fiche de réparation.
  const confirmDelivery = async (paidNow: number, discount: number, creditRest: boolean) => {
    setUpdating(true);
    try {
      const now = new Date().toISOString();
      const days = repair.warrantyDays || settings?.defaultWarrantyDays || 0;
      let warrantyUntil = repair.warrantyUntil;
      if (days > 0) { const d = new Date(); d.setDate(d.getDate() + days); warrantyUntil = d.toISOString(); }

      const dueAfterDiscount = Math.max(0, Math.round((repair.debt - discount) * 1000) / 1000);
      const restAfterPaidNow = Math.max(0, Math.round((dueAfterDiscount - paidNow) * 1000) / 1000);
      const newTotal = Math.max(0, Math.round((repair.total - discount) * 1000) / 1000);
      const newPaid = Math.round((repair.paid + paidNow) * 1000) / 1000;
      const newDebt = creditRest ? 0 : restAfterPaidNow;

      let note = `Livré — Encaissé ${paidNow.toFixed(3)} ${currency}`;
      if (discount > 0) note += `, remise ${discount.toFixed(3)} ${currency}`;
      if (creditRest && restAfterPaidNow > 0) note += `, ${restAfterPaidNow.toFixed(3)} ${currency} crédités au compte de ${repairClient?.name || 'client'}`;

      const log: RepairLog = { date: now, status: 'livre', note, by: currentUserLabel };
      const logs = [...(repair.logs || []), log];

      if (creditRest && restAfterPaidNow > 0) {
        if (!repairClient) throw new Error("Sélectionnez un client sur la fiche pour pouvoir créditer le reste dû.");
        await runTransaction(db, async (tx) => {
          const clientRef = doc(db, 'clients', repairClient.id);
          const clientSnap = await tx.get(clientRef);
          if (!clientSnap.exists()) throw new Error('Client introuvable');
          const currentClientDebt = clientSnap.data().debt || 0;
          tx.update(doc(db, 'repairs', repair.id), {
            status: 'livre', deliveredAt: now, warrantyUntil: warrantyUntil || null,
            total: newTotal, paid: newPaid, debt: newDebt, discount, logs,
          });
          tx.update(clientRef, { debt: currentClientDebt + restAfterPaidNow });
        });
      } else {
        await updateDoc(doc(db, 'repairs', repair.id), {
          status: 'livre', deliveredAt: now, warrantyUntil: warrantyUntil || null,
          total: newTotal, paid: newPaid, debt: newDebt, discount, logs,
        });
      }

      setShowDeliveryCaisse(false);
      onSuccess('Réparation livrée et encaissement enregistré.');
    } catch (e: any) {
      onError("Échec de l'encaissement : " + (e.message || e));
    } finally { setUpdating(false); }
  };

  const addNote = async () => {
    if (!quickNote.trim()) return;
    await changeStatus(repair.status);
  };

  const [printing, setPrinting] = useState(false);
  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrinting(false), 500);
    }, 100);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white rounded-t-3xl z-10">
          <div>
            <h2 className="text-lg font-black font-display text-indigo-600 font-mono">{repair.number}</h2>
            <span className={cn("inline-block mt-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border", STATUS_STYLES[repair.status])}>
              {REPAIR_STATUS_LABELS[repair.status]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="p-2 hover:bg-indigo-50 rounded-xl text-indigo-500" title="Modifier"><Edit3 className="w-4 h-4" /></button>
            {canDelete && <button onClick={onDelete} className="p-2 hover:bg-rose-50 rounded-xl text-rose-500" title="Supprimer"><Trash2 className="w-4 h-4" /></button>}
            <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
          </div>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Client + appareil */}
          <div className="grid grid-cols-2 gap-4">
            <InfoBlock icon={User} label="Client" value={repair.clientName || 'Sans client'} sub={repair.clientPhone} />
            <InfoBlock icon={Smartphone} label="Appareil" value={`${repair.deviceBrand || ''} ${repair.deviceModel || ''}`.trim() || '—'} sub={repair.imei ? `IMEI ${repair.imei}` : undefined} />
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 space-y-2 text-sm">
            <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Panne : </span><span className="text-slate-700 font-medium">{repair.problem}</span></div>
            {repair.diagnostic && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Diagnostic : </span><span className="text-slate-700 font-medium">{repair.diagnostic}</span></div>}
            {repair.accessories && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Accessoires : </span><span className="text-slate-700 font-medium">{repair.accessories}</span></div>}
            {repair.deviceCondition && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">État : </span><span className="text-slate-700 font-medium">{repair.deviceCondition}</span></div>}
            {repair.technician && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Technicien : </span><span className="text-slate-700 font-medium">{repair.technician}</span></div>}
          </div>

          {/* Pièces */}
          {repair.parts?.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Pièces utilisées</p>
              <div className="space-y-1">
                {repair.parts.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                    <span className="text-slate-700">{p.name} × {p.quantity}</span>
                    <span className="font-bold text-slate-800">{p.total.toFixed(2)} {currency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totaux */}
          <div className="grid grid-cols-3 gap-3">
            <MoneyBlock label="Total" value={repair.total} currency={currency} accent />
            <MoneyBlock label="Payé" value={repair.paid} currency={currency} />
            <MoneyBlock label="Reste dû" value={repair.debt} currency={currency} danger={repair.debt > 0} />
          </div>

          {repair.warrantyUntil && (
            <div className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold",
              new Date(repair.warrantyUntil) > new Date() ? "bg-teal-50 text-teal-700" : "bg-slate-50 text-slate-400")}>
              <Shield className="w-4 h-4" />
              Garantie jusqu'au {format(new Date(repair.warrantyUntil), 'dd/MM/yyyy')}
              {new Date(repair.warrantyUntil) < new Date() && ' (expirée)'}
            </div>
          )}

          {/* Changement rapide de statut */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Changer le statut</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {(Object.keys(REPAIR_STATUS_LABELS) as RepairStatus[]).map(s => (
                <button key={s} disabled={updating} onClick={() => changeStatus(s)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all disabled:opacity-50",
                    s === repair.status ? STATUS_STYLES[s] + " ring-2 ring-offset-1 ring-indigo-300" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-200")}>
                  {REPAIR_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={quickNote} onChange={(e) => setQuickNote(e.target.value)}
                placeholder="Ajouter une note de suivi (optionnel)..."
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              <button onClick={addNote} disabled={updating || !quickNote.trim()}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-40">Noter</button>
            </div>
          </div>

          {/* Historique */}
          {repair.logs?.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Historique de suivi</p>
              <div className="space-y-3">
                {[...repair.logs].reverse().map((log, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <div className="flex-1 -mt-0.5">
                      <p className="text-sm text-slate-700 font-medium">{log.note}</p>
                      <p className="text-[11px] text-slate-400 font-medium">
                        {format(new Date(log.date), 'dd/MM/yyyy HH:mm')}{log.by ? ` · ${log.by}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 p-5 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-3xl">
          <button onClick={handlePrint} className="flex items-center justify-center gap-2 flex-1 py-3 rounded-xl font-bold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
            <FileText className="w-4 h-4" /> Imprimer le bon
          </button>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">Fermer</button>
        </div>
      </div>

      {printing && createPortal(
        <div className="print-container">
          <RepairTicket repair={repair} ownerId={repair.ownerId} />
        </div>,
        document.body
      )}

      {showDeliveryCaisse && (
        <DeliveryCaisseModal
          repair={repair}
          client={repairClient}
          currency={currency}
          updating={updating}
          onClose={() => setShowDeliveryCaisse(false)}
          onConfirm={confirmDelivery}
        />
      )}
    </div>
  );
}

// ============================================================
//  FENÊTRE DE CAISSE À LA LIVRAISON (encaissement, remise, crédit client)
// ============================================================
function DeliveryCaisseModal({
  repair, client, currency, updating, onClose, onConfirm
}: {
  repair: Repair;
  client: Client | null;
  currency: string;
  updating: boolean;
  onClose: () => void;
  onConfirm: (paidNow: number, discount: number, creditRest: boolean) => void;
}) {
  const [discountInput, setDiscountInput] = useState('0');
  const [paidInput, setPaidInput] = useState(repair.debt.toFixed(3));
  const [formError, setFormError] = useState<string | null>(null);

  const discount = Math.max(0, parseFloat(discountInput.replace(',', '.')) || 0);
  const dueAfterDiscount = Math.max(0, Math.round((repair.debt - discount) * 1000) / 1000);
  const paidNow = Math.max(0, parseFloat(paidInput.replace(',', '.')) || 0);
  const restDue = Math.max(0, Math.round((dueAfterDiscount - paidNow) * 1000) / 1000);

  const handleEncaisser = () => {
    if (discount > repair.debt + 0.001) { setFormError("La remise ne peut pas dépasser le reste dû."); return; }
    if (paidNow > dueAfterDiscount + 0.001) { setFormError("Le montant encaissé ne peut pas dépasser le montant dû après remise."); return; }
    setFormError(null);
    onConfirm(paidNow, discount, false);
  };

  const handleCrediterClient = () => {
    if (!client) { setFormError("Cette réparation n'a pas de client associé — impossible d'enregistrer un crédit."); return; }
    if (discount > repair.debt + 0.001) { setFormError("La remise ne peut pas dépasser le reste dû."); return; }
    if (paidNow > dueAfterDiscount + 0.001) { setFormError("Le montant encaissé ne peut pas dépasser le montant dû après remise."); return; }
    if (restDue <= 0.001) { setFormError("Il n'y a aucun reste à créditer : le montant encaissé couvre déjà tout le dû."); return; }
    setFormError(null);
    onConfirm(paidNow, discount, true);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-teal-600" /> Caisse — Livraison
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MoneyBlock label="Total réparation" value={repair.total} currency={currency} accent />
            <MoneyBlock label="Reste dû actuel" value={repair.debt} currency={currency} danger={repair.debt > 0} />
          </div>

          {client && (
            <p className="text-xs font-bold text-slate-500">Client : <span className="text-slate-800">{client.name}</span></p>
          )}

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Remise ({currency})</label>
            <input
              type="text" inputMode="decimal" value={discountInput}
              onChange={(e) => { if (/^[\d.,]*$/.test(e.target.value)) setDiscountInput(e.target.value); }}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Montant encaissé maintenant ({currency})</label>
            <input
              type="text" inputMode="decimal" value={paidInput}
              onChange={(e) => { if (/^[\d.,]*$/.test(e.target.value)) setPaidInput(e.target.value); }}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Reste après cet encaissement</span>
            <span className={cn("font-black text-sm", restDue > 0 ? "text-rose-600" : "text-emerald-600")}>{restDue.toFixed(3)} {currency}</span>
          </div>

          {formError && (
            <div className="flex items-start gap-2 bg-rose-50 text-rose-700 text-xs font-bold px-3 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {formError}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 p-5 border-t border-slate-100">
          <button
            onClick={handleEncaisser} disabled={updating}
            className="w-full py-3 rounded-xl font-bold text-sm text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50"
          >
            Livrer & Encaisser {restDue > 0 ? '(reste en dette)' : ''}
          </button>
          <button
            onClick={handleCrediterClient} disabled={updating || !client}
            title={!client ? "Aucun client associé à cette réparation" : undefined}
            className="w-full py-3 rounded-xl font-bold text-sm text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-50"
          >
            Livrer & Créditer le reste au client
          </button>
          <button onClick={onClose} disabled={updating} className="w-full py-2.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-50 transition-colors">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-400 mb-1"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <p className="font-bold text-slate-800 truncate">{value}</p>
      {sub && <p className="text-xs text-slate-400 font-medium truncate">{sub}</p>}
    </div>
  );
}

function MoneyBlock({ label, value, currency, accent, danger }: { label: string; value: number; currency: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className={cn("rounded-2xl p-3 text-center", accent ? "bg-indigo-50" : danger ? "bg-rose-50" : "bg-slate-50")}>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn("font-black text-sm mt-0.5", accent ? "text-indigo-600" : danger ? "text-rose-600" : "text-slate-700")}>
        {(value || 0).toFixed(2)} {currency}
      </p>
    </div>
  );
}
