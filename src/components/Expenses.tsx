import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Expense, ExpenseCategory, EXPENSE_CATEGORY_LABELS, StoreSettings, UserProfile } from '../types';
import { Wallet, Plus, Search, Trash2, Pencil, X, AlertCircle, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';

interface ExpensesProps {
  userProfile: UserProfile | null;
}

const CATEGORY_BADGES: Record<ExpenseCategory, string> = {
  achat_pieces: 'bg-blue-50 text-blue-700 border-blue-200',
  charges: 'bg-amber-50 text-amber-700 border-amber-200',
  journaliere: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  autre: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function Expenses({ userProfile }: ExpensesProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showAllMonths, setShowAllMonths] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formDate, setFormDate] = useState('');
  const [formCategory, setFormCategory] = useState<ExpenseCategory>('journaliere');
  const [formLabel, setFormLabel] = useState('');
  const [formAmountInput, setFormAmountInput] = useState('');

  const currency = storeSettings?.currency || 'DT';

  useEffect(() => {
    const unsubExpenses = onSnapshot(
      query(collection(db, 'expenses'), where('ownerId', '==', ownerId)),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense));
        list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setExpenses(list);
      }
    );
    const unsubSettings = onSnapshot(doc(db, 'settings', ownerId), (snap) => {
      if (snap.exists()) setStoreSettings(snap.data() as StoreSettings);
    });
    return () => { unsubExpenses(); unsubSettings(); };
  }, [ownerId]);

  const filtered = useMemo(() => {
    return expenses.filter(e => {
      const matchesMonth = showAllMonths || (e.date || '').startsWith(monthFilter);
      const q = searchTerm.toLowerCase();
      const matchesSearch = !q ||
        (e.label || '').toLowerCase().includes(q) ||
        (EXPENSE_CATEGORY_LABELS[e.category] || '').toLowerCase().includes(q);
      return matchesMonth && matchesSearch;
    });
  }, [expenses, searchTerm, monthFilter, showAllMonths]);

  const totalFiltered = useMemo(() => filtered.reduce((s, e) => s + (e.amount || 0), 0), [filtered]);

  const openModal = (expense?: Expense) => {
    setErrorMsg(null);
    if (expense) {
      setEditing(expense);
      setFormDate((expense.date || '').slice(0, 10));
      setFormCategory(expense.category || 'autre');
      setFormLabel(expense.label || '');
      setFormAmountInput((expense.amount || 0).toFixed(3));
    } else {
      setEditing(null);
      setFormDate(new Date().toISOString().slice(0, 10));
      setFormCategory('journaliere');
      setFormLabel('');
      setFormAmountInput('');
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditing(null);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);

    const amount = Math.round((parseFloat(formAmountInput.replace(',', '.')) || 0) * 1000) / 1000;
    if (amount <= 0) {
      setErrorMsg('Le montant doit être supérieur à 0.');
      return;
    }
    if (!formLabel.trim()) {
      setErrorMsg('Veuillez saisir une description.');
      return;
    }

    try {
      setIsSubmitting(true);
      // Conserve l'heure courante pour un tri chronologique correct dans la journée
      const now = new Date();
      const dateIso = `${formDate}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

      if (editing) {
        await updateDoc(doc(db, 'expenses', editing.id), {
          date: editing.date && editing.date.startsWith(formDate) ? editing.date : dateIso,
          category: formCategory,
          label: formLabel.trim(),
          amount,
        });
      } else {
        await addDoc(collection(db, 'expenses'), {
          date: dateIso,
          category: formCategory,
          label: formLabel.trim(),
          amount,
          by: userProfile?.name || userProfile?.email || '',
          ownerId,
          userId: userProfile?.uid || ownerId,
          createdAt: new Date().toISOString(),
        });
      }
      closeModal();
    } catch (err) {
      console.error('Erreur enregistrement dépense:', err);
      setErrorMsg("Erreur d'enregistrement. Vérifiez votre connexion et réessayez.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (expense: Expense) => {
    if (!window.confirm(`Supprimer la dépense « ${expense.label} » (${(expense.amount || 0).toFixed(3)} ${currency}) ?`)) return;
    try {
      await deleteDoc(doc(db, 'expenses', expense.id));
    } catch (err) {
      console.error('Erreur suppression dépense:', err);
      alert('Erreur lors de la suppression.');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Dépenses</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">
            Chaque montant retiré de la caisse : achats de pièces, charges, dépenses journalières
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 shadow-lg shadow-emerald-600/15 group hover:-translate-y-0.5 cursor-pointer"
        >
          <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
          Nouvelle Dépense
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher une dépense..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="month"
              value={monthFilter}
              disabled={showAllMonths}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all disabled:opacity-50"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAllMonths}
              onChange={(e) => setShowAllMonths(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
            Tout
          </label>
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl px-5 py-3.5 mb-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center">
            <Wallet className="w-4.5 h-4.5 text-rose-500" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Total des dépenses {showAllMonths ? '(toutes périodes)' : 'du mois'}
            </p>
            <p className="text-[11px] text-slate-400">{filtered.length} opération{filtered.length > 1 ? 's' : ''}</p>
          </div>
        </div>
        <span className="text-xl font-black font-mono text-rose-600">
          {totalFiltered.toFixed(3)} <span className="text-xs">{currency}</span>
        </span>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-slate-200 rounded-2xl">
          <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100 mb-2">
            <AlertCircle className="w-5 h-5 text-slate-400" />
          </div>
          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Aucune dépense</h4>
          <p className="text-slate-400 text-[11px] mt-1">Cliquez sur « Nouvelle Dépense » pour enregistrer une sortie de caisse.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/70">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Catégorie</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3 text-right">Montant</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((exp) => {
                  const d = exp.date ? new Date(exp.date) : null;
                  return (
                    <tr key={exp.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap font-bold text-slate-600 font-mono">
                        {d ? d.toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={cn(
                          'inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border',
                          CATEGORY_BADGES[exp.category] || CATEGORY_BADGES.autre
                        )}>
                          {EXPENSE_CATEGORY_LABELS[exp.category] || 'Autre'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-700">{exp.label}</td>
                      <td className="px-5 py-3 text-right font-black font-mono text-rose-600 whitespace-nowrap">
                        {(exp.amount || 0).toFixed(3)} {currency}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => openModal(exp)}
                          className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                          title="Modifier la dépense"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(exp)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Supprimer la dépense"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal ajout / édition */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-600" />
                {editing ? 'Modifier la dépense' : 'Nouvelle dépense'}
              </h3>
              <button onClick={closeModal} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {errorMsg && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-1.5 text-rose-700 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as ExpenseCategory)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none bg-white"
                >
                  {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map(key => (
                    <option key={key} value={key}>{EXPENSE_CATEGORY_LABELS[key]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  required
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="Ex: Achat écrans iPhone, loyer, café..."
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Montant ({currency})</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={formAmountInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(',', '.');
                    if (value === '' || /^\d*\.?\d*$/.test(value)) setFormAmountInput(value);
                  }}
                  placeholder="0.000"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none font-mono"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Enregistrement...' : (editing ? 'Enregistrer' : 'Ajouter')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
