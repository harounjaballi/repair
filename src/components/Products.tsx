import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, setDoc, getDocs, where, getDocFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Category, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Plus, Search, Edit2, Trash2, X, AlertTriangle, Package, Tag, Barcode, Shield, Eye, EyeOff, AlertCircle, History, Loader2, ArrowDown, ArrowUp, Printer } from 'lucide-react';
import { cn, decodeAzertyBarcode, isSparePart, isService } from '../lib/utils';
import { Barcode as BarcodeLabel } from './Barcode';

interface ProductsProps {
  userProfile: UserProfile | null;
  // 'part' = pièces détachées (atelier), 'product' = produits vendables (caisse)
  mode?: 'part' | 'product';
}

export default function Products({ userProfile, mode = 'product' }: ProductsProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
  const isPartMode = mode === 'part';
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickCategoryModalOpen, setIsQuickCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanned' | 'error'>('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Empêche le double-clic sur "Enregistrer" / "Confirmer" (évite les ajouts en double)
  const [isSubmitting, setIsSubmitting] = useState(false);

  // States for security code modal (protects edit & delete)
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [securityCode, setSecurityCode] = useState('');
  const [securityError, setSecurityError] = useState(false);
  const [showSecurityInput, setShowSecurityInput] = useState(false);
  const [pendingAction, setPendingAction] = useState<'edit' | 'delete' | null>(null);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);

  // States for stock replenishment modal
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [replenishQty, setReplenishQty] = useState<string>('');
  const [replenishPrice, setReplenishPrice] = useState<string>('');

  // States for stock history modal (diagnostic: entrées vs ventes vs stock affiché)
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyMovements, setHistoryMovements] = useState<{ type: 'in' | 'out'; qty: number; date: Date | null; label: string }[]>([]);
  const [historyTotals, setHistoryTotals] = useState<{ totalIn: number; totalOut: number } | null>(null);

  const playBeep = (type: 'success' | 'error') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (type === 'success') {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 950;
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.12);
      } else {
        [0, 120].forEach((delay) => {
          setTimeout(() => {
            try {
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sawtooth';
              osc.frequency.value = 180;
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.15);
            } catch (innerErr) {}
          }, delay);
        });
      }
    } catch (err) {}
  };

  useEffect(() => {
    if (!isModalOpen) {
      setScanStatus('idle');
      setScanMessage('');
      return;
    }

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const isBarcodeInputFocused = target && target.tagName === 'INPUT' && (target as HTMLInputElement).placeholder?.includes('douchette');

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        if (isInputFocused && !isBarcodeInputFocused && interval > 120) {
          buffer = e.key;
          return;
        }

        if (interval > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      } else if (e.key === 'Enter') {
        const barcode = decodeAzertyBarcode(buffer.trim());
        buffer = '';
        lastKeyTime = 0;

        if (barcode.length >= 3) {
          playBeep('success');
          setFormData(prev => ({ ...prev, barcode }));
          setScanStatus('scanned');
          setScanMessage(`Code détecté avec succès : ${barcode}`);
          setTimeout(() => {
            setScanStatus('idle');
            setScanMessage('');
          }, 4500);

          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isModalOpen]);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    buyPrice: 0,
    sellPrice: 0,
    barcode: '',
    stock: 0,
    reference: '',
    compatibleModels: '',
    lowStockAlert: 5
  });

  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [sellPriceInput, setSellPriceInput] = useState('');

  // Impression d'une étiquette autocollante avec le code-barres du produit :
  // ligne 1 = SmarTECH, ligne 2 = nom du produit, ligne 3 = code-barres.
  // Utilise le même mécanisme .print-container (portal) que les tickets.
  const [printingLabel, setPrintingLabel] = useState<{ name: string; barcode: string } | null>(null);
  const printBarcodeLabel = () => {
    if (!formData.barcode) return;
    setPrintingLabel({ name: formData.name, barcode: formData.barcode });
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrintingLabel(null), 500);
    }, 150);
  };
  // Case « C'est un service » : masque prix d'achat / stock / alerte et
  // n'enregistre ni dépense ni mouvement de stock.
  const [isServiceForm, setIsServiceForm] = useState(false);

  useEffect(() => {
    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      const prods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      prods.sort((a, b) => {
        const dateA = a.createdAt || '';
        const dateB = b.createdAt || '';
        if (dateA && dateB) {
          return dateB.localeCompare(dateA);
        }
        if (dateA) return -1;
        if (dateB) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setProducts(prods);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });

    const unsubscribeCats = onSnapshot(query(collection(db, 'categories'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(cats);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'categories');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings');
    });

    return () => {
      unsubscribeProds();
      unsubscribeCats();
      unsubscribeSettings();
    };
  }, [ownerId]);

  // Vérifie une VRAIE connexion serveur avant toute écriture.
  // getDocFromServer force une lecture réseau : hors-ligne (ou faux navigator.onLine),
  // elle échoue → on n'écrit rien, donc aucune opération n'est mise en file ni rejouée.
  const ensureOnline = async (timeoutMs = 8000): Promise<void> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('OFFLINE')), timeoutMs);
    });
    try {
      // Lecture serveur d'un doc léger (le compteur du propriétaire). Peu importe qu'il existe.
      await Promise.race([
        getDocFromServer(doc(db, 'counters', `invoices_${ownerId}`)),
        timeout,
      ]);
    } catch {
      throw new Error('OFFLINE');
    } finally {
      clearTimeout(timer!);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (isSubmitting) return;

    // Un service n'a ni prix d'achat ni stock : on force ces valeurs à 0 pour
    // qu'aucune dépense ni mouvement de stock ne soit généré.
    if (isServiceForm) {
      formData.buyPrice = 0;
      formData.stock = 0;
      formData.lowStockAlert = 0;
    }

    // Garde-fou : le prix de vente doit être supérieur ou égal au prix d'achat,
    // sinon chaque vente de ce produit génère un bénéfice négatif.
    // (Ne s'applique pas aux services, dont le prix d'achat est toujours 0.)
    if (!isServiceForm && (formData.sellPrice || 0) < (formData.buyPrice || 0)) {
      setErrorMsg(
        `Le prix de vente (${(formData.sellPrice || 0).toFixed(3)}) doit être supérieur ou égal au prix d'achat (${(formData.buyPrice || 0).toFixed(3)}). Vendre en dessous du prix d'achat génère une perte sur chaque vente.`
      );
      return;
    }

    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire. Hors-ligne → aucune écriture.
      await ensureOnline();

      if (editingProduct) {
        const oldStock = editingProduct.stock || 0;
        const newStock = parseInt(formData.stock.toString()) || 0;

        // Recalculate existing supplies of this product
        const suppliesRef = collection(db, 'supplies');
        const q = query(suppliesRef, where('ownerId', '==', ownerId), where('productId', '==', editingProduct.id));
        const querySnapshot = await getDocs(q);

        for (const d of querySnapshot.docs) {
          const supplyData = d.data();
          const pName = formData.name;
          const bPrice = formData.buyPrice;
          const qty = supplyData.quantity || 0;
          const tCost = qty * bPrice;

          await updateDoc(doc(db, 'supplies', d.id), {
            productName: pName,
            buyPrice: bPrice,
            totalCost: tCost,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        }

        // La modification du stock via l'édition d'un produit ne génère AUCUNE dépense.
        // Seuls la création d'un produit (stock initial) et l'approvisionnement
        // créent des enregistrements dans 'supplies' (comptés comme dépenses).
        if (newStock !== oldStock) {
          console.log(`[DEBUG LOG] Produit "Modifié" (Stock ${newStock > oldStock ? 'Augmenté' : 'Diminué'} sans dépense) de ${editingProduct.name}:`, {
            productId: editingProduct.id,
            productName: formData.name,
            oldStock,
            newStock,
            buyPrice: formData.buyPrice
          });
        } else {
          console.log(`[DEBUG LOG] Produit "Modifié" (Stock inchangé) de ${editingProduct.name}:`, {
            productId: editingProduct.id,
            productName: formData.name,
            buyPrice: formData.buyPrice
          });
        }

        await updateDoc(doc(db, 'products', editingProduct.id), {
          ...formData,
          isPart: isServiceForm ? false : isPartMode,
          isService: isServiceForm,
          ownerId,
          userId: userProfile?.uid || ownerId
        });

        // Log d'audit (optionnel — ne bloque pas l'opération)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'UPDATE_PRODUCT',
            userEmail: userProfile?.email || 'unknown',
            userName: userProfile?.name || 'unknown',
            timestamp: new Date().toISOString(),
            productId: editingProduct.id,
            productName: formData.name,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
      } else {
        const docRef = await addDoc(collection(db, 'products'), {
          ...formData,
          isPart: isServiceForm ? false : isPartMode,
          isService: isServiceForm,
          createdAt: new Date().toISOString(),
          ownerId,
          userId: userProfile?.uid || ownerId
        });

        // Log d'audit (optionnel — ne bloque pas l'opération)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'CREATE_PRODUCT',
            userEmail: userProfile?.email || 'unknown',
            userName: userProfile?.name || 'unknown',
            timestamp: new Date().toISOString(),
            productId: docRef.id,
            productName: formData.name,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
        const stockInt = parseInt(formData.stock.toString()) || 0;
        if (stockInt > 0) {
          const expenseAmount = stockInt * formData.buyPrice;
          await addDoc(collection(db, 'supplies'), {
            productId: docRef.id,
            productName: formData.name,
            quantity: stockInt,
            buyPrice: formData.buyPrice,
            totalCost: expenseAmount,
            date: new Date(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
          console.log(`[DEBUG LOG] Produit "Créé":`, {
            productId: docRef.id,
            productName: formData.name,
            quantity: stockInt,
            buyPrice: formData.buyPrice,
            calculatedExpense: expenseAmount
          });
        } else {
          console.log(`[DEBUG LOG] Produit "Créé" sans stock initial:`, {
            productId: docRef.id,
            productName: formData.name
          });
        }
      }
      closeModal();
    } catch (error: any) {
      if (error?.message === 'OFFLINE') {
        setErrorMsg("Vérifiez votre connexion Internet.");
      } else {
        console.error("[ERROR] Failed to save product:", error);
        setErrorMsg(error?.message || String(error));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReplenishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replenishProduct || !replenishQty) return;

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire. Hors-ligne → aucune écriture.
      // Le verrou isSubmitting reste actif pendant toute la vérification : les reclics sont ignorés.
      await ensureOnline();

      const qty = parseInt(replenishQty) || 0;
      const price = parseFloat(replenishPrice) || 0;
      if (qty <= 0) return;

      const newStock = (replenishProduct.stock || 0) + qty;
      const expenseAmount = qty * price;
      
      // Update product stock and buy price (works locally offline via Firestore cache)
      await updateDoc(doc(db, 'products', replenishProduct.id), {
        stock: newStock,
        buyPrice: price,
        ownerId,
        userId: userProfile?.uid || ownerId
      });

      // Log supply entry
      await addDoc(collection(db, 'supplies'), {
        productId: replenishProduct.id,
        productName: replenishProduct.name,
        quantity: qty,
        buyPrice: price,
        totalCost: expenseAmount,
        date: new Date(),
        ownerId,
        userId: userProfile?.uid || ownerId
      });

      // Track in custom offline queue if offline to count pending operations
      // (Bloc conservé sans effet : l'approvisionnement hors-ligne est désormais bloqué en amont.)

      console.log(`[DEBUG LOG] Approvisionnement effectué pour "${replenishProduct.name}":`, {
        productId: replenishProduct.id,
        productName: replenishProduct.name,
        quantity: qty,
        buyPrice: price,
        calculatedExpense: expenseAmount
      });

      setReplenishProduct(null);
      setReplenishQty('');
      setReplenishPrice('');
      playBeep('success');
    } catch (error: any) {
      playBeep('error');
      if (error?.message === 'OFFLINE') {
        alert("Vérifiez votre connexion Internet.");
      } else {
        console.error("[ERROR] Failed to replenish product stock:", error);
        alert("Échec de l'approvisionnement. Réessayez.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Charge l'historique de stock d'un produit : entrées (supplies) et sorties (ventes),
  // pour comparer le stock théorique (entrées - ventes) au stock affiché.
  const openHistory = async (product: Product) => {
    setHistoryProduct(product);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryMovements([]);
    setHistoryTotals(null);

    const toDate = (d: any): Date | null => {
      if (!d) return null;
      if (d instanceof Date) return d;
      if (typeof d?.toDate === 'function') return d.toDate();
      if (typeof d?.seconds === 'number') return new Date(d.seconds * 1000);
      const parsed = new Date(d);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    try {
      const movements: { type: 'in' | 'out'; qty: number; date: Date | null; label: string }[] = [];
      let totalIn = 0;
      let totalOut = 0;

      // Entrées : collection 'supplies' filtrée par productId
      const suppliesSnap = await getDocs(query(
        collection(db, 'supplies'),
        where('ownerId', '==', ownerId),
        where('productId', '==', product.id)
      ));
      suppliesSnap.forEach((d) => {
        const s: any = d.data();
        const qty = Number(s.quantity) || 0;
        totalIn += qty;
        movements.push({ type: 'in', qty, date: toDate(s.date), label: 'Entrée / appro.' });
      });

      // Sorties : parcourir 'sales', sommer les items de ce produit
      const salesSnap = await getDocs(query(
        collection(db, 'sales'),
        where('ownerId', '==', ownerId)
      ));
      salesSnap.forEach((d) => {
        const sale: any = d.data();
        if (!Array.isArray(sale.items)) return;
        for (const item of sale.items) {
          if (item.productId === product.id) {
            const qty = Number(item.quantity) || 0;
            totalOut += qty;
            movements.push({ type: 'out', qty, date: toDate(sale.date), label: 'Vente' });
          }
        }
      });

      // Tri chronologique (les mouvements sans date en dernier)
      movements.sort((a, b) => {
        const ta = a.date ? a.date.getTime() : Infinity;
        const tb = b.date ? b.date.getTime() : Infinity;
        return ta - tb;
      });

      setHistoryMovements(movements);
      setHistoryTotals({ totalIn, totalOut });
    } catch (error: any) {
      console.error("[ERROR] Failed to load stock history:", error);
      setHistoryError(error?.message || String(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const executeProductDelete = async () => {
    if (!productToDelete) return;
    setErrorMsg(null);
    try {
      // Delete associated supplies
      const suppliesRef = collection(db, 'supplies');
      const q = query(suppliesRef, where('ownerId', '==', ownerId), where('productId', '==', productToDelete.id));
      const querySnapshot = await getDocs(q);
      for (const d of querySnapshot.docs) {
        await deleteDoc(doc(db, 'supplies', d.id));
      }

      await deleteDoc(doc(db, 'products', productToDelete.id));

      // Log d'audit (optionnel — ne bloque pas l'opération)
      try {
        const logRef = doc(collection(db, 'audit_logs'));
        await setDoc(logRef, {
          action: 'DELETE_PRODUCT',
          userEmail: userProfile?.email || 'unknown',
          userName: userProfile?.name || 'unknown',
          timestamp: new Date().toISOString(),
          productId: productToDelete.id,
          productName: productToDelete.name,
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      } catch (logErr) {
        console.warn('[AUDIT LOG] Failed:', logErr);
      }

      console.log(`[DEBUG] Produit supprimé: "${productToDelete.name}" (ID: ${productToDelete.id}). Quantité: ${productToDelete.stock}, Prix d'achat: ${productToDelete.buyPrice}. Toutes les dépenses correspondantes ont été supprimées.`);
      setProductToDelete(null);
    } catch (error: any) {
      console.error("[ERROR] Failed to delete product:", error);
      setErrorMsg(error?.message || String(error));
    }
  };

  const executeCategoryDelete = async (categoryId: string, categoryName: string) => {
    try {
      await deleteDoc(doc(db, 'categories', categoryId));
      if (formData.category === categoryName) {
        const remaining = categories.filter(c => c.id !== categoryId);
        setFormData(prev => ({ ...prev, category: remaining[0]?.name || '' }));
      }
      setDeletingCatId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'categories');
    }
  };

  const openModal = (product?: Product) => {
    setErrorMsg(null);
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category,
        buyPrice: product.buyPrice,
        sellPrice: product.sellPrice,
        barcode: product.barcode || '',
        stock: product.stock,
        reference: product.reference || '',
        compatibleModels: product.compatibleModels || '',
        lowStockAlert: product.lowStockAlert || 5
      });
      setBuyPriceInput(product.buyPrice.toFixed(3));
      setSellPriceInput(product.sellPrice.toFixed(3));
      setIsServiceForm(product.isService === true);
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        category: categories[0]?.name || 'produit',
        buyPrice: 0,
        sellPrice: 0,
        barcode: '',
        stock: 0,
        reference: '',
        compatibleModels: '',
        lowStockAlert: 5
      });
      setBuyPriceInput('');
      setSellPriceInput('');
      setIsServiceForm(false);
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setErrorMsg(null);
  };

  // Demande le code de sécurité avant d'autoriser une modification ou une suppression.
  // Chaque utilisateur a son propre code (défini par l'admin dans Gestion des Utilisateurs).
  // Si aucun code n'est configuré pour cet utilisateur, l'action est exécutée directement.
  const requestSecureAction = (action: 'edit' | 'delete', product: Product) => {
    const code = userProfile?.securityCode;
    if (code && code.length === 4) {
      setPendingAction(action);
      setPendingProduct(product);
      setSecurityCode('');
      setSecurityError(false);
      setShowSecurityInput(false);
      setShowSecurityModal(true);
    } else {
      if (action === 'edit') {
        openModal(product);
      } else {
        setProductToDelete(product);
      }
    }
  };

  const confirmSecureAction = () => {
    if (!pendingProduct || !pendingAction) return;
    if (securityCode === userProfile?.securityCode) {
      const action = pendingAction;
      const product = pendingProduct;
      setShowSecurityModal(false);
      setPendingAction(null);
      setPendingProduct(null);
      setSecurityCode('');
      setSecurityError(false);
      if (action === 'edit') {
        openModal(product);
      } else {
        setProductToDelete(product);
      }
    } else {
      setSecurityError(true);
      setSecurityCode('');
    }
  };

  const handleQuickCategoryAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (isSubmitting) return;

    const exists = categories.some(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
    if (exists) {
      alert('Cette catégorie existe déjà.');
      return;
    }
    
    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire.
      await ensureOnline();

      await addDoc(collection(db, 'categories'), {
        name: newCategoryName.trim(),
        type: 'autre',
        ownerId
      });
      setFormData(prev => ({ ...prev, category: newCategoryName.trim() }));
      setNewCategoryName('');
    } catch (error: any) {
      if (error?.message === 'OFFLINE') {
        alert("Vérifiez votre connexion Internet.");
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'categories');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDefaultCategories = async () => {
    if (!confirm('Voulez-vous restaurer les catégories de base par défaut ?')) return;
    const defaults = [
      { id: 'cat_pieces', name: 'Pièces détachées' },
      { id: 'cat_accessoires', name: 'Accessoires' },
      { id: 'cat_produits', name: 'Produits' },
      { id: 'cat_services', name: 'Services' }
    ];
    for (const cat of defaults) {
      try {
        await setDoc(doc(db, 'categories', cat.id + '_' + ownerId), {
          name: cat.name,
          type: 'autre',
          ownerId
        });
      } catch (err) {
        console.error('Error seeding category:', cat.name, err);
      }
    }
  };



  // Union des catégories Firestore + catégories réellement utilisées par les produits.
  // Garantit que le filtre n'est jamais vide même si la collection `categories`
  // est vide ou que ses documents n'ont pas le bon ownerId.
  const normalizeCat = (s: string) => (s || '').trim().toLowerCase();
  const filterCategories = React.useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach(c => {
      const key = normalizeCat(c.name);
      if (key && !map.has(key)) map.set(key, c.name.trim());
    });
    products.forEach(p => {
      const key = normalizeCat(p.category);
      if (key && !map.has(key)) map.set(key, (p.category || '').trim());
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [categories, products]);

  const filteredProducts = products.filter(p => {
    const matchesMode = isSparePart(p) === isPartMode;
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory =
      selectedCategory === 'all' || normalizeCat(p.category) === normalizeCat(selectedCategory);
    return matchesMode && matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">{isPartMode ? 'Pièces détachées' : 'Produits'}</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">{isPartMode ? 'Pièces utilisées pour les réparations (atelier)' : 'Produits vendables en caisse'}</p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => openModal()}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 shadow-lg shadow-indigo-600/15 group hover:-translate-y-0.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
            {isPartMode ? 'Nouvelle Pièce' : 'Nouveau Produit'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search bar */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
              <input
                type="text"
                name="product-search"
                autoComplete="off"
                placeholder={isPartMode ? 'Rechercher une pièce...' : 'Rechercher un produit...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all duration-300"
              />
            </div>

            {/* Category filter */}
            <div className="relative">
              <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 pointer-events-none" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="pl-10 pr-8 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all duration-300 appearance-none cursor-pointer min-w-[180px]"
              >
                <option value="all">Toutes les catégories</option>
                {filterCategories.map(catName => (
                  <option key={catName} value={catName}>{catName}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Active filter badge + reset */}
            {selectedCategory !== 'all' && (
              <button
                onClick={() => setSelectedCategory('all')}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                title="Réinitialiser le filtre"
              >
                <X className="w-3.5 h-3.5" />
                {selectedCategory}
              </button>
            )}
          </div>

          {/* Results summary */}
          {(searchTerm || selectedCategory !== 'all') && (
            <p className="mt-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {filteredProducts.length} résultat{filteredProducts.length !== 1 ? 's' : ''} trouvé{filteredProducts.length !== 1 ? 's' : ''}
              {selectedCategory !== 'all' && <span className="text-indigo-500"> · {selectedCategory}</span>}
            </p>
          )}
        </div>

        <div className="overflow-x-auto text-[13px] font-medium text-slate-600">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">
                <th className="px-6 py-4">Produit</th>
                <th className="px-6 py-4">Catégorie</th>
                <th className="px-6 py-4">Prix Achat</th>
                <th className="px-6 py-4">Prix Vente</th>
                <th className="px-6 py-4">Stock</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">Chargement...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">Aucun produit trouvé.</td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="flex flex-col gap-0.5">
                        {product.barcode && (
                          <div className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded w-fit">
                            Ref: {product.barcode}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                        (() => {
                           const cat = categories.find(c => c.name === product.category);
                           if (!cat) return "bg-indigo-50 text-indigo-700";
                           return cat.type === 'piece' ? "bg-blue-50 text-blue-700" :
                                  cat.type === 'accessoire' ? "bg-orange-50 text-orange-700" :
                                  cat.type === 'service' ? "bg-purple-50 text-purple-700" :
                                  "bg-indigo-50 text-indigo-700";
                        })()
                      )}>
                        {product.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 font-mono">{isService(product) ? '—' : `${product.buyPrice.toFixed(3)} ${storeSettings?.currency || 'DT'}`}</td>
                    <td className="px-6 py-4 text-gray-900 font-bold font-mono">{product.sellPrice.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                    <td className="px-6 py-4">
                      {isService(product) ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-150">Service</span>
                      ) : (
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "font-medium",
                          product.stock <= (product.lowStockAlert || 5) ? "text-red-600" : "text-gray-900"
                        )}>
                          {product.stock}
                        </span>
                        {product.stock <= (product.lowStockAlert || 5) && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isService(product) && (
                        <button
                          onClick={() => {
                            setReplenishProduct(product);
                            setReplenishQty('');
                            setReplenishPrice(product.buyPrice.toFixed(3));
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-all text-xs font-black uppercase tracking-wider cursor-pointer border border-emerald-150"
                          title="Approvisionner (ajouter du stock) pour ce produit"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>+ Stock</span>
                        </button>
                        )}

                        {!isService(product) && (
                        <button
                          onClick={() => openHistory(product)}
                          className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent"
                          title="Historique du stock (entrées / ventes) pour ce produit"
                        >
                          <History className="w-4 h-4" />
                        </button>
                        )}

                        <button
                          onClick={() => requestSecureAction('edit', product)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => requestSecureAction('delete', product)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-150">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900">
                {editingProduct ? 'Modifier Produit' : 'Nouveau Produit'}
              </h2>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
                {errorMsg && (
                  <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium animate-in fade-in duration-150">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="break-all">{errorMsg}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nom du produit</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                        Code à barre / Référence
                      </label>
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Scanner Douchette Prêt
                      </span>
                    </div>
                    
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <Barcode className="h-4.5 w-4.5 text-indigo-500 group-focus-within:text-indigo-600" />
                      </div>
                      <input
                        type="text"
                        placeholder="Pointez votre douchette et flashez, ou tapez ici..."
                        value={formData.barcode}
                        onChange={(e) => setFormData({ ...formData, barcode: decodeAzertyBarcode(e.target.value) })}
                        className="w-full pl-11 pr-44 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-xs font-bold font-mono text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all duration-300"
                      />
                      <div className="absolute inset-y-1.5 right-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const randomCode = '619' + Math.floor(1000000000 + Math.random() * 9000000000).toString();
                            setFormData({ ...formData, barcode: randomCode });
                            playBeep('success');
                          }}
                          className="h-full px-2.5 bg-slate-100 hover:bg-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                          title="Générer un code-barres aléatoire commençant par 619 Tunisie"
                        >
                          Générer
                        </button>
                        <button
                          type="button"
                          onClick={printBarcodeLabel}
                          disabled={!formData.barcode}
                          className={cn(
                            "h-full px-2.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-colors border flex items-center gap-1",
                            formData.barcode
                              ? "bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-indigo-100 cursor-pointer"
                              : "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed"
                          )}
                          title="Imprimer l'étiquette autocollante avec le code-barres"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Imprimer
                        </button>
                      </div>
                    </div>

                    {scanStatus === 'scanned' && (
                      <div className="text-[11px] font-black text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-xl border border-emerald-100 flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <span>{scanMessage}</span>
                      </div>
                    )}
                    
                    <p className="text-[10px] text-slate-500 font-sans leading-relaxed">
                      Vous pouvez scanner directement le produit à tout moment pendant que ce formulaire est ouvert. La douchette remplira automatiquement ce champ et émettra un signal sonore.
                    </p>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                    <div className="flex gap-2">
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-slate-800 bg-white"
                        required
                      >
                        {categories.length === 0 ? (
                          <option value="">⚠️ Veuillez créer une catégorie</option>
                        ) : (
                          <>
                            <option value="">-- Choisir une catégorie --</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.name}>{cat.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => setIsQuickCategoryModalOpen(true)}
                        className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors cursor-pointer"
                        title="Ajouter une catégorie"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {!isPartMode && (
                    <div className="col-span-2">
                      <label className="flex items-center gap-2.5 px-4 py-2.5 border border-gray-200 rounded-xl bg-emerald-50/40 cursor-pointer hover:bg-emerald-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={isServiceForm}
                          onChange={(e) => setIsServiceForm(e.target.checked)}
                          className="w-4 h-4 accent-emerald-600"
                        />
                        <span className="text-sm font-medium text-slate-700">
                          C'est un service (main-d'œuvre) — sans prix d'achat ni stock
                        </span>
                      </label>
                    </div>
                  )}

                  {!isServiceForm && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock Initial</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.stock}
                      onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  )}

                  {!isServiceForm && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alerte Stock Faible</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.lowStockAlert}
                      onChange={(e) => setFormData({ ...formData, lowStockAlert: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  )}

                  {!isServiceForm && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix Achat ({storeSettings?.currency || 'DT'})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={buyPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setBuyPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, buyPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(buyPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setBuyPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, buyPrice: rounded });
                      }}
                      placeholder="0.00"
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  )}

                  <div className={isServiceForm ? 'col-span-2' : ''}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix Vente ({storeSettings?.currency || 'DT'})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={sellPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setSellPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, sellPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(sellPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setSellPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, sellPrice: rounded });
                      }}
                      placeholder="0.00"
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  {!isServiceForm && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Référence pièce</label>
                    <input
                      type="text"
                      value={formData.reference}
                      onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                      placeholder="Ex: LCD-IP12"
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none box-border"
                    />
                  </div>
                  )}
                  {!isServiceForm && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Modèles compatibles</label>
                    <input
                      type="text"
                      value={formData.compatibleModels}
                      onChange={(e) => setFormData({ ...formData, compatibleModels: e.target.value })}
                      placeholder="Ex: iPhone 12, 12 Pro"
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none box-border"
                    />
                  </div>
                  )}
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-gray-100 p-4 bg-gray-50/70 flex gap-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2.5 bg-gray-150 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors cursor-pointer text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/15 cursor-pointer text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Enregistrement…' : (editingProduct ? 'Enregistrer' : 'Ajouter')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Quick Category Modal */}
      {isQuickCategoryModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <Tag className="w-4 h-4 text-indigo-500 animate-pulse" />
                Gérer les Catégories
              </h2>
              <button onClick={() => setIsQuickCategoryModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-5">
              {/* Add form */}
              <form onSubmit={handleQuickCategoryAdd} className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600">Nouveau nom de catégorie</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    required
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="flex-1 px-3.5 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-xs font-semibold placeholder:text-slate-400 bg-slate-50 focus:bg-white transition-all text-slate-900"
                    placeholder="Ex: Boissons, Fruits..."
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter
                  </button>
                </div>
              </form>

              {/* List of existing categories */}
              <div className="space-y-2.5">
                <span className="block text-xs font-black uppercase tracking-wider text-slate-600 border-b border-slate-100 pb-1.5 mb-1">
                  Catégories existantes ({categories.length})
                </span>
                
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {categories.length === 0 ? (
                    <p className="text-center py-6 text-slate-400 text-xs font-medium">Aucune catégorie enregistrée.</p>
                  ) : (
                    categories.map((cat) => (
                      <div key={cat.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-100 rounded-xl transition-all group">
                        {deletingCatId === cat.id ? (
                          <div className="flex items-center justify-between w-full animate-in fade-in slide-in-from-right-1 duration-150">
                            <span className="text-[11px] font-black text-red-600 uppercase tracking-wider flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                              Supprimer?
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDeletingCatId(null)}
                                className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-200 rounded-lg transition-colors cursor-pointer"
                              >
                                Non
                              </button>
                              <button
                                type="button"
                                onClick={() => executeCategoryDelete(cat.id, cat.name)}
                                className="px-2.5 py-1 text-[10px] font-black text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all cursor-pointer"
                              >
                                Oui
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                              <Tag className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                              {cat.name}
                            </span>
                            
                            <button
                              type="button"
                              onClick={() => setDeletingCatId(cat.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title={`Supprimer la catégorie ${cat.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-50 bg-slate-50/50 flex justify-between items-center">
              <button
                type="button"
                onClick={handleResetDefaultCategories}
                className="text-slate-500 hover:text-indigo-600 text-[10px] font-black uppercase tracking-wider underline cursor-pointer"
                title="Restaurer les catégories de base par défaut"
              >
                Réinit. défauts
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeletingCatId(null);
                  setIsQuickCategoryModalOpen(false);
                }}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Code Modal (protects edit & delete) */}
      {showSecurityModal && pendingProduct && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Shield className="w-4 h-4 text-rose-500" />
                Code de sécurité requis
              </h3>
              <button
                onClick={() => { setShowSecurityModal(false); setPendingAction(null); setPendingProduct(null); setSecurityCode(''); setSecurityError(false); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500 font-medium">
                Saisissez le code de sécurité à 4 chiffres pour autoriser {pendingAction === 'edit' ? 'la modification' : 'la suppression'} du produit <strong className="text-slate-800">"{pendingProduct.name}"</strong>.
              </p>
              <div className="relative">
                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400" />
                <input
                  type={showSecurityInput ? 'text' : 'password'}
                  name="product-security-code"
                  autoComplete="one-time-code"
                  maxLength={4}
                  inputMode="numeric"
                  autoFocus
                  value={securityCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                    setSecurityCode(val);
                    setSecurityError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && securityCode.length === 4) {
                      confirmSecureAction();
                    }
                  }}
                  placeholder="● ● ● ●"
                  className={`w-full pl-9 pr-10 py-3 border-2 rounded-xl text-center text-xl font-mono font-black tracking-[0.5em] outline-none transition-colors ${
                    securityError
                      ? 'border-red-400 bg-red-50 text-red-700 focus:border-red-500'
                      : 'border-slate-200 bg-white text-slate-800 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecurityInput(!showSecurityInput)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showSecurityInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" /> }
                </button>
              </div>
              {securityError && (
                <p className="text-xs text-red-600 font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Code incorrect. Veuillez réessayer.
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowSecurityModal(false); setPendingAction(null); setPendingProduct(null); setSecurityCode(''); setSecurityError(false); }}
                  className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors uppercase tracking-wider"
                >
                  Annuler
                </button>
                <button
                  onClick={confirmSecureAction}
                  className="flex-1 px-4 py-2.5 bg-rose-600 text-white text-xs font-black rounded-xl hover:bg-rose-700 transition-colors uppercase tracking-wider shadow-md shadow-rose-600/20"
                >
                  Valider
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-50 text-red-600 rounded-xl">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Supprimer le produit ?</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Êtes-vous sûr de vouloir supprimer définitivement le produit <strong className="text-slate-800">"{productToDelete.name}"</strong> ? Cette action est irréversible.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium animate-in fade-in duration-150">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}
            
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={executeProductDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors shadow-md shadow-red-600/10 cursor-pointer"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replenish Stock Modal */}
      {replenishProduct && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-slate-100">
            <div className="flex-shrink-0 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                Approvisionner : {replenishProduct.name}
              </h3>
              <button 
                onClick={() => setReplenishProduct(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleReplenishSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                    Quantité à ajouter au stock
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="Ex: 50"
                    value={replenishQty}
                    onChange={(e) => setReplenishQty(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-indigo-500 outline-none text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                    Prix d'achat unitaire ({storeSettings?.currency || 'DT'})
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    min="0.001"
                    placeholder="Ex: 2.500"
                    value={replenishPrice}
                    onChange={(e) => setReplenishPrice(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-indigo-500 outline-none text-xs font-bold font-mono"
                  />
                </div>

                {replenishQty && replenishPrice && (
                  <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-xl space-y-1 my-2">
                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                      <span>Quantité :</span>
                      <span className="font-bold text-slate-700">{replenishQty}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                      <span>Prix unitaire :</span>
                      <span className="font-bold text-slate-700">{parseFloat(replenishPrice).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                    <div className="border-t border-slate-200/50 my-1.5 pt-1.5 flex justify-between text-xs font-bold text-slate-800">
                      <span>Dépense totale estimée :</span>
                      <span className="text-emerald-700 font-black">
                        {(parseInt(replenishQty) * parseFloat(replenishPrice)).toFixed(3)} {storeSettings?.currency || 'DT'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 border-t border-slate-100 p-4 bg-slate-50/70 flex gap-3 justify-end pb-[calc(1rem+env(safe-area-inset-bottom,0px))] animate-in fade-in duration-200">
                <button
                  type="button"
                  onClick={() => setReplenishProduct(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-650 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-emerald-600/10 cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'En cours…' : 'Confirmer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock History Modal (diagnostic) */}
      {historyProduct && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-150">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                Historique : {historyProduct.name}
              </h2>
              <button
                onClick={() => setHistoryProduct(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
              {historyLoading && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="text-sm font-medium">Chargement de l'historique…</span>
                </div>
              )}

              {!historyLoading && historyError && (
                <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Erreur : {historyError}</span>
                </div>
              )}

              {!historyLoading && !historyError && historyTotals && (() => {
                const displayedStock = historyProduct.stock || 0;
                const theoretical = historyTotals.totalIn - historyTotals.totalOut;
                const gap = displayedStock - theoretical;
                return (
                  <>
                    {/* Résumé */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Entrées</div>
                        <div className="text-xl font-black text-emerald-700">{historyTotals.totalIn}</div>
                      </div>
                      <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Ventes</div>
                        <div className="text-xl font-black text-blue-700">{historyTotals.totalOut}</div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Théorique</div>
                        <div className="text-xl font-black text-slate-700">{theoretical}</div>
                      </div>
                    </div>

                    {/* Verdict écart */}
                    <div className={cn(
                      "p-4 rounded-xl border flex items-start gap-3",
                      gap === 0 ? "bg-emerald-50 border-emerald-150" : "bg-amber-50 border-amber-150"
                    )}>
                      {gap === 0
                        ? <Package className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
                      <div className="text-xs leading-relaxed">
                        <div className="font-bold text-gray-800">
                          Stock affiché : {displayedStock} &nbsp;·&nbsp; Théorique : {theoretical} &nbsp;·&nbsp; Écart : {gap > 0 ? '+' : ''}{gap}
                        </div>
                        <div className="mt-1 text-gray-600">
                          {gap === 0 && "Cohérent : le stock affiché correspond aux mouvements enregistrés."}
                          {gap > 0 && `${gap} unité(s) en trop. Cause probable : édition manuelle du stock, ou vente hors-ligne dont la décrémentation a été écrasée à la synchronisation.`}
                          {gap < 0 && `${-gap} unité(s) manquante(s). Cause probable : vente comptée en double, ou approvisionnement non enregistré.`}
                        </div>
                      </div>
                    </div>

                    {/* Journal des mouvements */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                        Mouvements ({historyMovements.length})
                      </div>
                      {historyMovements.length === 0 ? (
                        <div className="text-sm text-gray-400 italic py-4 text-center">
                          Aucun mouvement enregistré. Le stock a probablement été saisi manuellement.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {historyMovements.map((m, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                {m.type === 'in'
                                  ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" />
                                  : <ArrowDown className="w-3.5 h-3.5 text-blue-600" />}
                                <span className="font-medium text-gray-700">{m.label}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-gray-400">
                                  {m.date ? m.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                                </span>
                                <span className={cn(
                                  "font-black tabular-nums",
                                  m.type === 'in' ? "text-emerald-600" : "text-blue-600"
                                )}>
                                  {m.type === 'in' ? '+' : '−'}{m.qty}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="flex-shrink-0 border-t border-slate-100 p-4 bg-slate-50/70 flex justify-end pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <button
                type="button"
                onClick={() => setHistoryProduct(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-650 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Étiquette autocollante code-barres (impression) — format 50 × 30 mm */}
      {printingLabel && createPortal(
        <div className="print-container">
          <style>{`
            @media print {
              @page { size: 50mm 30mm; margin: 0 !important; }
            }
            .barcode-label-print svg{max-width:100%;height:auto;display:block;margin:0 auto}
          `}</style>
          <div
            className="barcode-label-print bg-white text-black font-sans"
            style={{ width: '50mm', height: '30mm', margin: 0, textAlign: 'center', padding: '1mm 1.5mm 0', boxSizing: 'border-box', overflow: 'hidden' }}
          >
            <div style={{ fontWeight: 900, fontSize: '13px', letterSpacing: '0.5px', lineHeight: 1.1 }}>SmarTECH</div>
            <div style={{ fontSize: '10px', fontWeight: 700, lineHeight: 1.1, marginTop: '0.5mm', wordBreak: 'break-word', maxHeight: '7mm', overflow: 'hidden' }}>{printingLabel.name || '—'}</div>
            <div style={{ marginTop: '0.5mm' }}>
              <BarcodeLabel value={printingLabel.barcode} height={30} moduleWidth={1.2} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
