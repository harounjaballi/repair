import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, setDoc, getDocs, where, getDocFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Category, Brand, StoreSettings, UserProfile } from '../types';
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
  const [brands, setBrands] = useState<Brand[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickCategoryModalOpen, setIsQuickCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isQuickBrandModalOpen, setIsQuickBrandModalOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [deletingBrandId, setDeletingBrandId] = useState<string | null>(null);
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

  const [printingLabel, setPrintingLabel] = useState<{ name: string; barcode: string } | null>(null);
  
  const printBarcodeLabel = () => {
    if (!formData.barcode) return;
    setPrintingLabel({ name: formData.name, barcode: formData.barcode });
    setTimeout(() => {
      try {
        window.print();
        setTimeout(() => setPrintingLabel(null), 1000);
      } catch (e) {
        console.error('Erreur impression:', e);
      }
    }, 200);
  };

  const [isServiceForm, setIsServiceForm] = useState(false);

  useEffect(() => {
    if (!isModalOpen) {
      setScanStatus('idle');
      setScanMessage('');
      return;
    }

    let buffer = '';
    let lastKeyTime = 0;
    let burstFast = true;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;

    const commitScan = (): boolean => {
      if (commitTimer) { clearTimeout(commitTimer); commitTimer = undefined; }
      const barcode = decodeAzertyBarcode(buffer.trim());
      buffer = '';
      lastKeyTime = 0;
      burstFast = true;

      if (barcode.length >= 3) {
        playBeep('success');
        setFormData(prev => ({ ...prev, barcode }));
        setScanStatus('scanned');
        setScanMessage(`Code détecté avec succès : ${barcode}`);
        setTimeout(() => {
          setScanStatus('idle');
          setScanMessage('');
        }, 4500);
        return true;
      }
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const isBarcodeInputFocused = target && target.tagName === 'INPUT' && (target as HTMLInputElement).placeholder?.includes('douchette');

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        if (commitTimer) { clearTimeout(commitTimer); commitTimer = undefined; }

        if (isInputFocused && !isBarcodeInputFocused && interval > 120) {
          buffer = e.key;
          burstFast = true;
          return;
        }

        if (interval > 120) {
          buffer = e.key;
          burstFast = true;
        } else {
          buffer += e.key;
          if (interval > 80) burstFast = false;
        }

        if (burstFast && buffer.length >= 6) {
          commitTimer = setTimeout(() => { commitScan(); }, 300);
        }
      } else if (e.key === 'Enter') {
        if (commitScan()) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === 'Tab') {
        if (burstFast && buffer.length >= 3) {
          if (commitScan()) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (commitTimer) clearTimeout(commitTimer);
    };
  }, [isModalOpen]);

  const [formData, setFormData] = useState({
    name: '',
    category: '',
    brand: '',
    buyPrice: 0,
    sellPrice: 0,
    discount: 0,
    barcode: '',
    stock: 0,
    reference: '',
    compatibleModels: '',
    lowStockAlert: 0,
    characteristics: ''
  });

  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [sellPriceInput, setSellPriceInput] = useState('');
  const [discountInput, setDiscountInput] = useState('');

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

    const unsubscribeBrands = onSnapshot(query(collection(db, 'brands'), where('ownerId', '==', ownerId)), (snapshot) => {
      const brs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand));
      brs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setBrands(brs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'brands');
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
      unsubscribeBrands();
      unsubscribeSettings();
    };
  }, [ownerId]);

  const ensureOnline = async (timeoutMs = 8000): Promise<void> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('OFFLINE')), timeoutMs);
    });
    try {
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

    if (isSubmitting) return;

    if (isServiceForm) {
      formData.buyPrice = 0;
      formData.stock = 0;
      formData.lowStockAlert = 0;
    }

    if (!isServiceForm && (formData.sellPrice || 0) < (formData.buyPrice || 0)) {
      setErrorMsg(
        `Le prix de vente (${(formData.sellPrice || 0).toFixed(3)}) doit être supérieur ou égal au prix d'achat (${(formData.buyPrice || 0).toFixed(3)}). Vendre en dessous du prix d'achat génère une perte sur chaque vente.`
      );
      return;
    }

    try {
      setIsSubmitting(true);

      await ensureOnline();

      if (editingProduct) {
        const oldStock = editingProduct.stock || 0;
        const newStock = parseInt(formData.stock.toString()) || 0;

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

  const quickAdjustStock = async (product: Product, delta: number) => {
    const current = product.stock || 0;
    if (delta < 0 && current <= 0) return;
    const newStock = Math.max(0, current + delta);
    try {
      await updateDoc(doc(db, 'products', product.id), { stock: newStock });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'products');
    }
  };

  const handleReplenishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replenishProduct || !replenishQty) return;

    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      await ensureOnline();

      const qty = parseInt(replenishQty) || 0;
      const price = parseFloat(replenishPrice) || 0;
      if (qty <= 0) return;

      const newStock = (replenishProduct.stock || 0) + qty;
      const expenseAmount = qty * price;
      
      await updateDoc(doc(db, 'products', replenishProduct.id), {
        stock: newStock,
        buyPrice: price,
        ownerId,
        userId: userProfile?.uid || ownerId
      });

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
      const suppliesRef = collection(db, 'supplies');
      const q = query(suppliesRef, where('ownerId', '==', ownerId), where('productId', '==', productToDelete.id));
      const querySnapshot = await getDocs(q);
      for (const d of querySnapshot.docs) {
        await deleteDoc(doc(db, 'supplies', d.id));
      }

      await deleteDoc(doc(db, 'products', productToDelete.id));

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
        const remaining = scopedCategories.filter(c => c.id !== categoryId);
        setFormData(prev => ({ ...prev, category: remaining[0]?.name || '' }));
      }
      setDeletingCatId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'categories');
    }
  };

  const executeBrandDelete = async (brandId: string, brandName: string) => {
    try {
      await deleteDoc(doc(db, 'brands', brandId));
      if (formData.brand === brandName) {
        const remaining = brands.filter(b => b.id !== brandId);
        setFormData(prev => ({ ...prev, brand: remaining[0]?.name || '' }));
      }
      setDeletingBrandId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'brands');
    }
  };

  const openModal = (product?: Product) => {
    setErrorMsg(null);
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category,
        brand: product.brand || '',
        buyPrice: product.buyPrice,
        sellPrice: product.sellPrice,
        discount: product.discount ?? 0,
        barcode: product.barcode || '',
        stock: product.stock,
        reference: product.reference || '',
        compatibleModels: product.compatibleModels || '',
        lowStockAlert: product.lowStockAlert ?? 0,
        characteristics: product.characteristics || ''
      });
      setBuyPriceInput(product.buyPrice.toFixed(3));
      setSellPriceInput(product.sellPrice.toFixed(3));
      setDiscountInput((product.discount ?? 0) === 0 ? '' : (product.discount ?? 0).toFixed(3));
      setIsServiceForm(product.isService === true);
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        category: scopedCategories[0]?.name || (isPartMode ? 'piece' : 'produit'),
        brand: isPartMode ? (brands[0]?.name || '') : '',
        buyPrice: 0,
        sellPrice: 0,
        discount: 0,
        barcode: '',
        stock: 0,
        reference: '',
        compatibleModels: '',
        lowStockAlert: 0,
        characteristics: ''
      });
      setBuyPriceInput('');
      setSellPriceInput('');
      setDiscountInput('');
      setIsServiceForm(false);
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setErrorMsg(null);
  };

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

    if (isSubmitting) return;

    const exists = categories.some(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
    if (exists) {
      alert('Cette catégorie existe déjà.');
      return;
    }
    
    try {
      setIsSubmitting(true);

      await ensureOnline();

      await addDoc(collection(db, 'categories'), {
        name: newCategoryName.trim(),
        type: isPartMode ? 'piece' : (isServiceForm ? 'service' : 'produit'),
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

  const handleQuickBrandAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName.trim()) return;

    if (isSubmitting) return;

    const exists = brands.some(b => b.name.toLowerCase() === newBrandName.trim().toLowerCase());
    if (exists) {
      alert('Cette marque existe déjà.');
      return;
    }

    try {
      setIsSubmitting(true);

      await ensureOnline();

      await addDoc(collection(db, 'brands'), {
        name: newBrandName.trim(),
        ownerId
      });
      setFormData(prev => ({ ...prev, brand: newBrandName.trim() }));
      setNewBrandName('');
    } catch (error: any) {
      if (error?.message === 'OFFLINE') {
        alert("Vérifiez votre connexion Internet.");
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'brands');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDefaultCategories = async () => {
    if (!confirm('Voulez-vous restaurer les catégories de base par défaut ?')) return;
    const defaults = [
      { id: 'cat_pieces', name: 'Pièces détachées', type: 'piece' },
      { id: 'cat_accessoires', name: 'Accessoires', type: 'accessoire' },
      { id: 'cat_produits', name: 'Produits', type: 'produit' },
      { id: 'cat_services', name: 'Services', type: 'service' }
    ];
    for (const cat of defaults) {
      try {
        await setDoc(doc(db, 'categories', cat.id + '_' + ownerId), {
          name: cat.name,
          type: cat.type,
          ownerId
        });
      } catch (err) {
        console.error('Error seeding category:', cat.name, err);
      }
    }
  };

  const normalizeCat = (s: string) => (s || '').trim().toLowerCase();

  const getEffectiveCategoryType = React.useCallback((c: Category): string => {
    if (c.type && c.type !== 'autre') return c.type;
    const key = normalizeCat(c.name);
    if (key === normalizeCat('Pièces détachées')) return 'piece';
    if (key === normalizeCat('Accessoires')) return 'accessoire';
    if (key === normalizeCat('Produits')) return 'produit';
    if (key === normalizeCat('Services')) return 'service';
    const usedByPart = products.some(p => normalizeCat(p.category) === key && isSparePart(p));
    const usedByProduct = products.some(p => normalizeCat(p.category) === key && !isSparePart(p));
    if (usedByPart && !usedByProduct) return 'piece';
    if (usedByProduct && !usedByPart) return 'produit';
    return 'autre';
  }, [products]);

  const scopedCategories = React.useMemo(
    () => categories.filter(c => {
      const t = getEffectiveCategoryType(c);
      return isPartMode ? (t === 'piece' || t === 'autre') : (t !== 'piece');
    }),
    [categories, isPartMode, getEffectiveCategoryType]
  );

  const filterCategories = React.useMemo(() => {
    const map = new Map<string, string>();
    scopedCategories.forEach(c => {
      const key = normalizeCat(c.name);
      if (key && !map.has(key)) map.set(key, c.name.trim());
    });
    products.filter(p => isSparePart(p) === isPartMode).forEach(p => {
      const key = normalizeCat(p.category);
      if (key && !map.has(key)) map.set(key, (p.category || '').trim());
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [scopedCategories, products, isPartMode]);

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
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">{isPartMode ? 'Pièces détachées' : 'Articles'}</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">{isPartMode ? 'Pièces utilisées pour les réparations (atelier)' : 'Articles vendables en caisse'}</p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => openModal()}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 shadow-lg shadow-indigo-600/15 group hover:-translate-y-0.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
            {isPartMode ? 'Nouvelle Pièce' : 'Nouvel Article'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
              <input
                type="text"
                name="product-search"
                autoComplete="off"
                placeholder={isPartMode ? 'Rechercher une pièce...' : 'Rechercher un article...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all duration-300"
              />
            </div>

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
                <th className="px-6 py-4">{isPartMode ? 'Pièce' : 'Article'}</th>
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
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">{isPartMode ? 'Aucune pièce trouvée.' : 'Aucun article trouvé.'}</td>
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
                        {product.characteristics && (
                          <div className="text-[10px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded mt-0.5">
                            💻 {product.characteristics}
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
                          product.stock <= (product.lowStockAlert ?? 0) ? "text-red-600" : "text-gray-900"
                        )}>
                          {product.stock}
                        </span>
                        {product.stock <= (product.lowStockAlert ?? 0) && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                        <div className="flex items-center gap-1 ml-1">
                          <button
                            onClick={() => quickAdjustStock(product, -1)}
                            disabled={(product.stock || 0) <= 0}
                            className="w-6 h-6 flex items-center justify-center rounded-md bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 font-black text-sm leading-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            title="Retirer 1 du stock"
                          >
                            −
                          </button>
                          <button
                            onClick={() => quickAdjustStock(product, 1)}
                            className="w-6 h-6 flex items-center justify-center rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100 font-black text-sm leading-none transition-colors cursor-pointer"
                            title="Ajouter 1 au stock"
                          >
                            +
                          </button>
                        </div>
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

      {/* MODALS AND OTHER UI - truncated for brevity in this format */}
      
      {/* Code-barres label print portal */}
      {printingLabel && createPortal(
        <div className="print-container">
          <style>{`
            @page { size: 40mm 30mm !important; margin: 0 !important; }
            @media print { * { margin: 0 !important; padding: 0 !important; } html, body { width: 40mm !important; height: 30mm !important; } }
          `}</style>
          <div style={{ width: '40mm', height: '30mm', margin: 0, padding: '2px', boxSizing: 'border-box', textAlign: 'center', fontSize: '7.5px', fontFamily: 'monospace', overflow: 'hidden' }}>
            <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '1px' }}>SmarTech</div>
            <div style={{ borderTop: '1px solid black', margin: '1px 0' }}></div>
            <div style={{ fontSize: '6px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '0.5px', lineHeight: '1.2' }}>
              {'*'.repeat(printingLabel.barcode.length)}
            </div>
            <div style={{ fontSize: '6px', fontWeight: 'bold', wordBreak: 'break-all', marginBottom: '0.5px', maxWidth: '35mm' }}>
              {printingLabel.barcode}
            </div>
            <div style={{ fontSize: '8px', fontWeight: 'bold', marginBottom: '0.5px' }}>{printingLabel.name.substring(0, 18)}</div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
