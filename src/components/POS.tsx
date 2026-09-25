import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, serverTimestamp, runTransaction, getDoc, getDocs, where, getDocFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Client, SaleItem, Sale, Invoice, Category, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, ShoppingCart, Trash2, Plus, Minus, User, CreditCard, CheckCircle, AlertCircle, Printer, X, FileText, Barcode, Filter, Tag, Coins, Percent, TrendingUp, UserCheck, Flame } from 'lucide-react';
import { cn, decodeAzertyBarcode, isSparePart, isService } from '../lib/utils';
import { format } from 'date-fns';
import { PrintableTicket } from './PrintableTicket';

interface POSProps {
  userProfile: UserProfile | null;
}

export default function POS({ userProfile }: POSProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [receivedCash, setReceivedCash] = useState<number>(0);
  const [receivedCashInput, setReceivedCashInput] = useState('0');
  const [isReceivedCashFocused, setIsReceivedCashFocused] = useState(false);

  const [discount, setDiscount] = useState<number>(0);
  const [discountInput, setDiscountInput] = useState('0');
  const [isDiscountFocused, setIsDiscountFocused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [scannerActive, setScannerActive] = useState(true);
  const [scanNotification, setScanNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState<string>('');

  // Modale de vente à crédit
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [creditPartialInput, setCreditPartialInput] = useState('');
  const [creditModalError, setCreditModalError] = useState<string | null>(null);

  const handlePrint = () => {
    console.log('Impression du ticket en cours...', lastInvoice);
    if (!lastInvoice) {
      console.warn('Aucune facture à imprimer.');
      return;
    }
    // Small delay to ensure the ticket is rendered in the DOM
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.error('Erreur lors de l\'impression:', e);
        alert('L\'impression a échoué. Veuillez essayer d\'ouvrir l\'application dans un nouvel onglet.');
      }
    }, 500);
  };

  useEffect(() => {
    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      const prods = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Product))
        // La caisse ne vend que les produits : les pièces détachées (atelier) sont exclues.
        .filter(p => !isSparePart(p));
      prods.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setProducts(prods);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'products');
    });
    const unsubscribeClients = onSnapshot(query(collection(db, 'clients'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
      cls.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setClients(cls);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'clients');
    });
    const unsubscribeCats = onSnapshot(query(collection(db, 'categories'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(cats);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'categories');
    });
    const unsubscribeStore = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `settings/${ownerId}`);
    });
    return () => {
      unsubscribeProds();
      unsubscribeClients();
      unsubscribeCats();
      unsubscribeStore();
    };
  }, [ownerId]);

  // Auto-clear helper for scan notification
  useEffect(() => {
    if (scanNotification) {
      const timer = setTimeout(() => setScanNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [scanNotification]);

  // Audio synths for scanner beeps
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
        // Double low pitch beep for error
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
            } catch (innerErr) {
              console.warn(innerErr);
            }
          }, delay);
        });
      }
    } catch (err) {
      console.warn('Audio feedback failed (might require user interaction first):', err);
    }
  };

  // Global barcode reader logic for physical laser scanners (douchette)
  useEffect(() => {
    if (!scannerActive) return;

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      
      // If user is actively typing in an input, let the browser handle keyboard events natively to prevent conflicts
      if (isInputFocused) {
        return;
      }

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        // Physical barcode scanners transmit keyboard events at high speed (usually < 50ms)
        // If the interval is high (> 120ms), it's either the very first character of a scan or human keystrokes.
        // We set it as the new first character of our buffer.
        if (interval > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      } else if (e.key === 'Enter') {
        const barcode = decodeAzertyBarcode(buffer.trim());
        buffer = ''; // reset buffer
        lastKeyTime = 0;

        if (barcode.length >= 3) {
          // Find matching product
          const matchedProduct = products.find(p => p.barcode === barcode);
          if (matchedProduct) {
            if (!isService(matchedProduct) && matchedProduct.stock <= 0) {
              setScanNotification({
                message: `Rupture de Stock pour ${matchedProduct.name}`,
                type: 'error'
              });
              playBeep('error');
            } else {
              addToCart(matchedProduct);
              setScanNotification({
                message: `Code : ${barcode} | Ajouté : ${matchedProduct.name}`,
                type: 'success'
              });
              playBeep('success');
            }
            e.preventDefault();
            e.stopPropagation();
          } else {
            setScanNotification({
              message: `Code non reconnu : ${barcode}`,
              type: 'error'
            });
            playBeep('error');
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [scannerActive, products]);

  // Fréquence de vente par produit (quantités cumulées) pour trier les raccourcis
  const [salesQtyMap, setSalesQtyMap] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!ownerId || ownerId === 'no_user_auth') return;
    getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId)))
      .then(snapshot => {
        const map: Record<string, number> = {};
        snapshot.docs.forEach(d => {
          const items = (d.data().items || []) as SaleItem[];
          items.forEach(item => {
            if (item.productId) map[item.productId] = (map[item.productId] || 0) + (item.quantity || 0);
          });
        });
        setSalesQtyMap(map);
      })
      .catch(err => console.error('[POS] Chargement fréquences de vente:', err));
  }, [ownerId]);

  const filteredProducts = useMemo(() => 
    products.filter(p => {
      const searchLower = searchTerm.toLowerCase();
      const decodedSearch = decodeAzertyBarcode(searchTerm).toLowerCase();
      
      const matchesName = p.name.toLowerCase().includes(searchLower);
      const matchesBarcode = p.barcode ? (
        p.barcode.toLowerCase().includes(searchLower) || 
        (decodedSearch && p.barcode.toLowerCase().includes(decodedSearch))
      ) : false;
      const matchesReference = p.reference ? p.reference.toLowerCase().includes(searchLower) : false;
      
      return (matchesName || matchesBarcode || matchesReference) && 
             (selectedCategory === 'all' || p.category === selectedCategory) &&
             (isService(p) || p.stock > 0);
    }).sort((a, b) => {
      const qtyDiff = (salesQtyMap[b.id] || 0) - (salesQtyMap[a.id] || 0);
      if (qtyDiff !== 0) return qtyDiff;
      return a.name.localeCompare(b.name);
    }),
    [products, searchTerm, selectedCategory, salesQtyMap]
  );

  // Top 3 des meilleures ventes (badge sur les raccourcis)
  const topSellerIds = useMemo(() => {
    return new Set(
      products
        .filter(p => (salesQtyMap[p.id] || 0) > 0)
        .sort((a, b) => (salesQtyMap[b.id] || 0) - (salesQtyMap[a.id] || 0))
        .slice(0, 3)
        .map(p => p.id)
    );
  }, [products, salesQtyMap]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim() !== '') {
      const trimmedSearch = searchTerm.trim();
      const decodedSearch = decodeAzertyBarcode(trimmedSearch);
      // Code à barre exact (original ou décodé AZERTY), sinon référence exacte
      const product =
        products.find(p => p.barcode === trimmedSearch || p.barcode === decodedSearch) ||
        products.find(p => p.reference && p.reference.toLowerCase() === trimmedSearch.toLowerCase());
      if (product) {
        if (!isService(product) && product.stock <= 0) {
          setScanNotification({ message: `Rupture : ${product.name}`, type: 'error' });
          playBeep('error');
        } else {
          addToCart(product);
          setScanNotification({ message: `Ajouté : ${product.name}`, type: 'success' });
          playBeep('success');
          setSearchTerm('');
        }
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  // Article du panier sélectionné pour le contrôle clavier (flèches)
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);

  const addToCart = (product: Product) => {
    const service = isService(product);
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        // Un service reste à quantité 1 (pas de cumul).
        if (service) {
          return prev;
        }
        if (existing.quantity >= product.stock) {
          setError(`Stock insuffisant pour ${product.name} (Disponible: ${product.stock})`);
          setTimeout(() => setError(null), 3000);
          return prev;
        }
        return prev.map(item => 
          item.productId === product.id 
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price }
            : item
        );
      }
      // Le dernier article ajouté apparaît en haut du ticket
      return [{
        productId: product.id,
        name: product.name,
        quantity: 1,
        price: product.sellPrice,
        total: product.sellPrice,
        buyPrice: product.buyPrice || 0, // Figé au moment de la vente
        // Référence et code-barres copiés pour l'étiquette imprimée
        // (ajoutés seulement s'ils existent : Firestore refuse les valeurs undefined)
        ...(product.reference ? { reference: product.reference } : {}),
        ...(product.barcode ? { barcode: product.barcode } : {})
      }, ...prev];
    });
    setSelectedCartItemId(product.id);
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
        const product = products.find(p => p.id === productId);
        // Un service est verrouillé à quantité 1.
        if (product && isService(product)) {
          return item;
        }
        const newQty = Math.max(1, item.quantity + delta);
        
        if (product) {
          if (newQty > product.stock) {
            setError(`Stock insuffisant pour ${item.name} (Disponible: ${product.stock})`);
            setTimeout(() => setError(null), 3000);
            return item;
          }
        }
        
        return { ...item, quantity: newQty, total: newQty * item.price };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  // Garde une sélection valide dans le panier (par défaut : l'article en haut, le dernier ajouté)
  useEffect(() => {
    if (cart.length === 0) {
      if (selectedCartItemId !== null) setSelectedCartItemId(null);
      return;
    }
    if (!cart.some(i => i.productId === selectedCartItemId)) {
      setSelectedCartItemId(cart[0].productId);
    }
  }, [cart, selectedCartItemId]);

  // Refs toujours à jour pour éviter les closures périmées dans le handler clavier global
  // (initialisées à vide car validateSale est déclarée plus bas dans le composant)
  const validateSaleRef = useRef<(isCredit?: boolean, creditPaid?: number) => void>(() => {});
  const updateQuantityRef = useRef<(productId: string, delta: number) => void>(() => {});
  useEffect(() => {
    validateSaleRef.current = validateSale;
    updateQuantityRef.current = updateQuantity;
  });

  // Raccourcis clavier globaux du POS :
  // - Entrée = Encaisser & Valider (ou "Nouvelle Vente" si le ticket de succès est affiché)
  // - Flèches ↑/↓ = choisir un article du panier | ←/→ = diminuer/augmenter sa quantité
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Fenêtre ticket (succès) affichée : Entrée = Nouvelle Vente
      if (saleSuccess) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setSaleSuccess(null);
          setLastInvoice(null);
        }
        return;
      }

      // Modale crédit ouverte : laisser le clavier à la modale
      if (isCreditModalOpen) return;

      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (isInputFocused) return;

      if (e.key === 'Enter') {
        // Une Entrée déjà consommée par le scanner code-barres (defaultPrevented) est ignorée
        if (e.defaultPrevented) return;
        if (cart.length > 0 && !isProcessing) {
          e.preventDefault();
          validateSaleRef.current(false);
        }
        return;
      }

      if (cart.length === 0) return;
      const idx = cart.findIndex(i => i.productId === selectedCartItemId);
      const currentIdx = idx >= 0 ? idx : 0;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCartItemId(cart[Math.min(cart.length - 1, currentIdx + 1)].productId);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCartItemId(cart[Math.max(0, currentIdx - 1)].productId);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedCartItemId(cart[currentIdx].productId);
        updateQuantityRef.current(cart[currentIdx].productId, 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedCartItemId(cart[currentIdx].productId);
        updateQuantityRef.current(cart[currentIdx].productId, -1);
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [saleSuccess, isCreditModalOpen, cart, isProcessing, selectedCartItemId]);

  const setQuantityDirect = (productId: string, newQty: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    // Un service reste toujours à quantité 1.
    if (isService(product)) return;
    if (newQty < 1) {
      removeFromCart(productId);
      return;
    }
    if (newQty > product.stock) {
      setError(`Stock insuffisant pour ${product.name} (Disponible: ${product.stock})`);
      setTimeout(() => setError(null), 3000);
      return;
    }
    setCart(prev => prev.map(item =>
      item.productId === productId
        ? { ...item, quantity: newQty, total: newQty * item.price }
        : item
    ));
  };

  const subtotal = useMemo(() => {
    const rawSum = cart.reduce((sum, item) => sum + item.total, 0);
    return Math.round(rawSum * 1000) / 1000;
  }, [cart]);
  const currency = storeSettings?.currency || 'DT';

  const cartTotal = useMemo(() => {
    return Math.max(0, Math.round((subtotal - discount) * 1000) / 1000);
  }, [subtotal, discount]);

  useEffect(() => {
    setReceivedCash(cartTotal);
  }, [selectedClient, cartTotal]);

  useEffect(() => {
    if (!isReceivedCashFocused) {
      setReceivedCashInput(receivedCash === 0 ? '' : receivedCash.toFixed(3));
    }
  }, [receivedCash, isReceivedCashFocused]);

  useEffect(() => {
    if (!isDiscountFocused) {
      setDiscountInput(discount === 0 ? '' : discount.toFixed(3));
    }
  }, [discount, isDiscountFocused]);

  const paidAmount = useMemo(() => {
    return Math.min(receivedCash, cartTotal);
  }, [receivedCash, cartTotal]);

  const remainingDebt = Math.round(Math.max(0, cartTotal - paidAmount) * 1000) / 1000;

  // Benefice estimé du panier de vente (sellPrice - buyPrice)
  const estimatedBenefit = useMemo(() => {
    const rawProfit = cart.reduce((sum, item) => {
      const prod = products.find(p => p.id === item.productId);
      const buyP = prod?.buyPrice || 0;
      const profit = (item.price - buyP) * item.quantity;
      return sum + profit;
    }, 0);
    return Math.max(0, Math.round((rawProfit - discount) * 1000) / 1000);
  }, [cart, products, discount]);

  const downloadPDF = async (invoice: Invoice) => {
    try {
      const response = await fetch('/api/invoices/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...invoice,
          date: format(new Date(), 'dd/MM/yyyy HH:mm')
        })
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${invoice.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      console.error('Erreur PDF:', error);
    }
  };

  const validateSale = async (isCredit: boolean = false, creditPaid: number = 0) => {
    if (cart.length === 0) return;

    // Crédit : un client enregistré est obligatoire (impossible pour un client de passage)
    if (isCredit && !selectedClient) {
      setError('Veuillez sélectionner un client. Un crédit ne peut pas être enregistré pour un client de passage.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    console.log('Starting POS validation...', { cart, selectedClient, paidAmount, isCredit, creditPaid });

    // Règle de paiement selon le type de client (ignorée en mode crédit : rien n'est encaissé)
    if (!isCredit) {
      if (!selectedClient) {
        if (Math.abs(paidAmount - cartTotal) > 0.001) {
          setError(`Pour un client passagé, le montant payé doit être obligatoirement égal au montant total de la vente (${cartTotal.toFixed(3)} ${currency}).`);
          setIsProcessing(false);
          return;
        }
      } else {
        if (paidAmount > cartTotal + 0.001) {
          setError(`Le montant payé ne peut pas dépasser le montant total de la vente (${cartTotal.toFixed(3)} ${currency}).`);
          setIsProcessing(false);
          return;
        }
      }
    }

    // Montants effectifs : en mode crédit, la tranche éventuellement payée est encaissée, le reste passe en dette
    const effPaid = isCredit ? Math.min(Math.max(0, Math.round(creditPaid * 1000) / 1000), cartTotal) : paidAmount;
    const effDebt = isCredit ? Math.round((cartTotal - effPaid) * 1000) / 1000 : remainingDebt;

    try {
      let generatedInvoice: Invoice | null = null;

      // Vérifie une VRAIE connexion serveur avant la vente. getDocFromServer force une
      // lecture réseau : hors-ligne (ou faux navigator.onLine), elle échoue → on bloque net,
      // aucune écriture ni mise en file, donc pas de rejeu multiple à la reconnexion.
      try {
        const preflight = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OFFLINE')), 8000)
        );
        await Promise.race([
          getDocFromServer(doc(db, 'counters', `invoices_${ownerId}`)),
          preflight,
        ]);
      } catch {
        throw new Error('Vérifiez votre connexion Internet.');
      }

      {
        // --- ONLINE SALE FLOW ---
        await runTransaction(db, async (transaction) => {
          console.log('Transaction started');
          
          // 1. ALL READS FIRST
          const counterRef = doc(db, 'counters', `invoices_${ownerId}`);
          const counterSnap = await transaction.get(counterRef);
          
          const productSnaps = await Promise.all(
            cart.map(item => transaction.get(doc(db, 'products', item.productId)))
          );

          let clientSnap = null;
          if (selectedClient && effDebt > 0) {
            clientSnap = await transaction.get(doc(db, 'clients', selectedClient.id));
          }

          // 2. LOGIC & VALIDATION
          let nextNum = 1;
          if (counterSnap.exists()) {
            nextNum = (counterSnap.data().lastNum || 0) + 1;
          }
          console.log('Next invoice number:', nextNum);
          
          const year = new Date().getFullYear();
          const invoiceNumber = `FAC-${year}-${nextNum.toString().padStart(4, '0')}`;

          // Validate products and stock
          const stockUpdates: { ref: any, newStock: number }[] = [];
          for (let i = 0; i < cart.length; i++) {
            const item = cart[i];
            const productSnap = productSnaps[i];
            if (!productSnap.exists()) throw new Error(`Produit ${item.name} introuvable`);
            // Un service n'a pas de stock : ni validation, ni décrémentation.
            if (productSnap.data().isService === true) continue;
            const currentStock = productSnap.data().stock || 0;
            if (currentStock < item.quantity) throw new Error(`Stock insuffisant pour ${item.name} (Disponible: ${currentStock})`);
            stockUpdates.push({
              ref: doc(db, 'products', item.productId),
              newStock: currentStock - item.quantity
            });
          }

          // Validate client
          let clientUpdate = null;
          if (selectedClient && effDebt > 0) {
            if (!clientSnap || !clientSnap.exists()) throw new Error(`Client introuvable`);
            const currentDebt = clientSnap.data().debt || 0;
            clientUpdate = {
              ref: doc(db, 'clients', selectedClient.id),
              newDebt: currentDebt + effDebt
            };
          }

          // 3. ALL WRITES LAST
          transaction.set(counterRef, { lastNum: nextNum }, { merge: true });

          for (const update of stockUpdates) {
            transaction.update(update.ref, { stock: update.newStock });
          }

          if (clientUpdate) {
            transaction.update(clientUpdate.ref, { debt: clientUpdate.newDebt });
            transaction.set(doc(collection(db, 'client_debts')), {
              clientId: selectedClient!.id,
              type: 'achat',
              reference: invoiceNumber,
              amount: effDebt,
              date: serverTimestamp(),
              ownerId,
              userId: userProfile?.uid || ownerId
            });
          }

          const saleRef = doc(collection(db, 'sales'));
          const invoiceRef = doc(collection(db, 'invoices'));

          const saleData = {
            id: saleRef.id,
            date: serverTimestamp(),
            clientId: selectedClient?.id || null,
            clientCode: selectedClient?.code || '',
            clientName: selectedClient?.name || 'Client de passage',
            total: cartTotal,
            paid: effPaid,
            debt: effDebt,
            items: cart,
            invoiceId: invoiceRef.id,
            ownerId,
            userId: userProfile?.uid || ownerId
          };

          const invoiceData = {
            id: invoiceRef.id,
            number: invoiceNumber,
            saleId: saleRef.id,
            clientId: selectedClient?.id || null,
            clientCode: selectedClient?.code || '',
            clientName: selectedClient?.name || 'Client de passage',
            clientPhone: selectedClient?.phone || '',
            clientAddress: selectedClient?.address || '',
            total: cartTotal,
            paid: effPaid,
            debt: effDebt,
            date: serverTimestamp(),
            items: cart,
            ownerId,
            userId: userProfile?.uid || ownerId
          };

          transaction.set(saleRef, saleData);
          transaction.set(invoiceRef, invoiceData);
          
          generatedInvoice = invoiceData as any;
          console.log('Transaction operations queued');
        });
      }

      console.log('Sale committed successfully');
      setSaleSuccess(isCredit ? 'Vente enregistrée à crédit !' : 'Vente validée avec succès !');
      setLastInvoice(generatedInvoice);
      setCart([]);
      setReceivedCash(0);
      setReceivedCashInput('0');
      setDiscount(0);
      setDiscountInput('0');
      setSelectedClient(null);
    } catch (err: any) {
      console.error('Validation failed:', err);
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, 'sales');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-130px)] min-h-0 relative">
      {/* Hidden printable ticket for POS - Render outside #root using Portal */}
      {createPortal(
        <div className="print-container">
          {lastInvoice && (
            <PrintableTicket invoice={lastInvoice} ownerId={ownerId} />
          )}
        </div>,
        document.body
      )}

      {/* Floating Scan Notification */}
      {scanNotification && (
        <div className={cn(
          "absolute top-14 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2 px-4 py-2 rounded-full shadow-md border text-xs font-bold animate-in fade-in slide-in-from-top-4 duration-200 backdrop-blur-md transition-all",
          scanNotification.type === 'success'
            ? "bg-emerald-50/95 border-emerald-200 text-emerald-800"
            : "bg-rose-50/95 border-rose-200 text-rose-800"
        )}>
          <div className={cn(
            "w-2 h-2 rounded-full animate-ping shrink-0",
            scanNotification.type === 'success' ? "bg-emerald-500" : "bg-rose-500"
          )} />
          <span>{scanNotification.message}</span>
        </div>
      )}

      {/* En-tête de la caisse */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
            <ShoppingCart className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <h1 className="text-xl font-extrabold text-slate-900">Caisse</h1>
            <p className="text-xs text-slate-500 font-medium">{format(new Date(), 'dd/MM/yyyy')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setScannerActive(!scannerActive)}
            title="Activer / désactiver le lecteur code à barre"
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full font-bold border transition-colors cursor-pointer",
              scannerActive
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-slate-100 text-slate-500 border-slate-200"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full", scannerActive ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
            {scannerActive ? 'Scanner prêt' : 'Scanner inactif'}
          </button>
          {userProfile?.name && (
            <span className="hidden sm:inline text-slate-500 font-medium">Caissier : {userProfile.name}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-1 gap-3 flex-1 min-h-0">
        {/* Gauche : catalogue des articles */}
        <div className="order-2 lg:order-1 lg:col-span-7 flex flex-col min-h-0 lg:h-full">
          {/* Barre de scan / recherche */}
          <div className="flex items-center gap-3 bg-white border-2 border-emerald-500 rounded-2xl px-4 py-3 mb-3 shadow-sm">
            <Barcode className={cn("w-6 h-6 text-emerald-700 shrink-0", scannerActive && "animate-pulse")} />
            <input
              type="text"
              placeholder="Scanner, ou rechercher nom, code à barre, référence…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="flex-1 min-w-0 bg-transparent outline-none text-base font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-medium"
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 cursor-pointer" title="Effacer">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Catégories */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-3 no-scrollbar">
            <button
              onClick={() => setSelectedCategory('all')}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border cursor-pointer",
                selectedCategory === 'all'
                  ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                  : "bg-white text-slate-500 border-slate-200 hover:border-emerald-300 hover:text-emerald-700"
              )}
            >
              Tout
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border cursor-pointer",
                  selectedCategory === cat.name
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                    : "bg-white text-slate-500 border-slate-200 hover:border-emerald-300 hover:text-emerald-700"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Grille des articles */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 pb-2 pr-1 content-start scrollbar-thin">
            {filteredProducts.length === 0 && (
              <div className="col-span-full py-16 text-center text-sm text-slate-400 font-medium">Aucun article trouvé</div>
            )}
            {filteredProducts.map((product) => {
              const outOfStock = !isService(product) && product.stock <= 0;
              const lowStock = !isService(product) && !outOfStock && product.stock <= 5;
              const cat = categories.find(c => c.name === product.category);
              const dotColor = !cat ? "bg-emerald-500" :
                cat.type === 'piece' ? "bg-blue-500" :
                cat.type === 'accessoire' ? "bg-orange-500" :
                cat.type === 'service' ? "bg-teal-500" : "bg-emerald-500";
              return (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={outOfStock}
                  className={cn(
                    "relative bg-white rounded-2xl border border-slate-200 p-3 text-left flex flex-col min-w-0 w-full cursor-pointer transition-all duration-150",
                    "hover:border-emerald-500 active:scale-[0.98]",
                    outOfStock && "bg-slate-50 cursor-not-allowed hover:border-slate-200"
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 truncate min-w-0">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
                      <span className="truncate">{product.category}</span>
                    </span>
                    {topSellerIds.has(product.id) ? (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold shrink-0">
                        <Flame className="w-3 h-3" /> Top
                      </span>
                    ) : (salesQtyMap[product.id] || 0) > 0 ? (
                      <span className="text-[10px] font-semibold text-emerald-600 shrink-0">{salesQtyMap[product.id]} vendus</span>
                    ) : null}
                  </div>
                  <h3 className={cn("font-bold text-[13px] leading-snug line-clamp-2 min-h-[36px]", outOfStock ? "text-slate-400" : "text-slate-800")}>
                    {product.name}
                  </h3>
                  {product.reference && (
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">Réf {product.reference}</p>
                  )}
                  <div className="flex items-baseline justify-between gap-1 mt-auto pt-2">
                    <span className={cn("text-[15px] font-extrabold truncate", outOfStock ? "text-slate-400" : "text-emerald-700")}>
                      {product.sellPrice.toFixed(3)} <span className="text-[10px] font-bold">{currency}</span>
                    </span>
                    {isService(product) ? (
                      <span className="text-[11px] font-semibold text-teal-600 shrink-0">Service</span>
                    ) : (
                      <span className={cn(
                        "text-[11px] shrink-0",
                        outOfStock ? "text-rose-600 font-bold" : lowStock ? "text-amber-600 font-bold" : "text-slate-500 font-medium"
                      )}>
                        {outOfStock ? 'Épuisé' : `${product.stock} en stock`}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Droite : panier et encaissement */}
        <div className="order-1 lg:order-2 lg:col-span-5 min-h-0 lg:h-full">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-col gap-2.5 h-full min-h-0 overflow-hidden">

            {/* Client */}
            <div className="relative">
              <UserCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600 pointer-events-none" />
              <select
                value={selectedClient?.id || ''}
                onChange={(e) => {
                  const client = clients.find(c => c.id === e.target.value);
                  setSelectedClient(client || null);
                  if (!client) {
                    setReceivedCash(cartTotal);
                    setReceivedCashInput(cartTotal.toFixed(3));
                  }
                }}
                className="w-full pl-9 pr-3 py-2.5 bg-white border border-dashed border-slate-300 rounded-xl text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all cursor-pointer"
              >
                <option value="">Client de passage</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.phone || 'Pas de tel'})</option>
                ))}
              </select>
            </div>

            {/* En-tête panier */}
            <div className="flex items-baseline justify-between">
              <h2 className="font-extrabold text-slate-900 text-[15px]">
                Panier <span className="text-slate-400 font-semibold text-xs">({cart.length} article{cart.length > 1 ? 's' : ''})</span>
              </h2>
              <button
                onClick={() => {
                  setCart([]);
                  setDiscount(0);
                  setDiscountInput('0');
                }}
                disabled={cart.length === 0}
                className="text-xs font-semibold text-slate-400 hover:text-rose-600 transition-colors disabled:opacity-30 cursor-pointer"
              >
                Vider
              </button>
            </div>

            {/* Lignes du panier */}
            <div className="flex-1 overflow-y-auto min-h-[80px] -mx-1 px-1 scrollbar-thin">
              {cart.length === 0 ? (
                <div className="h-full py-10 flex flex-col items-center justify-center text-slate-400 gap-2 text-center">
                  <ShoppingCart className="w-10 h-10 opacity-30" />
                  <p className="text-xs font-medium">Scannez un article ou touchez-en un pour commencer la vente.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {cart.map((item) => (
                    <div
                      key={item.productId}
                      onClick={() => setSelectedCartItemId(item.productId)}
                      className={cn(
                        "flex items-center gap-2 px-2 py-2 rounded-xl transition-colors cursor-pointer group",
                        selectedCartItemId === item.productId ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-slate-50"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 text-[13px] leading-snug truncate" title={item.name}>{item.name}</p>
                        <p className="text-[11px] text-slate-500 font-medium">{item.price.toFixed(3)} × {item.quantity}</p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.productId, -1); }}
                          disabled={item.quantity <= 1}
                          className="w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-700 flex items-center justify-center hover:border-emerald-500 hover:text-emerald-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          title="Diminuer la quantité"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>

                        {editingQtyId === item.productId ? (
                          <input
                            type="number"
                            min="1"
                            autoFocus
                            onFocus={(e) => e.target.select()}
                            onClick={(e) => e.stopPropagation()}
                            value={editingQtyValue}
                            onChange={(e) => setEditingQtyValue(e.target.value)}
                            onBlur={() => {
                              const parsed = parseInt(editingQtyValue);
                              if (!isNaN(parsed) && parsed > 0) {
                                setQuantityDirect(item.productId, parsed);
                              }
                              setEditingQtyId(null);
                              setEditingQtyValue('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const parsed = parseInt(editingQtyValue);
                                if (!isNaN(parsed) && parsed > 0) {
                                  setQuantityDirect(item.productId, parsed);
                                }
                                setEditingQtyId(null);
                                setEditingQtyValue('');
                                e.preventDefault();
                              }
                              if (e.key === 'Escape') {
                                setEditingQtyId(null);
                                setEditingQtyValue('');
                              }
                              e.stopPropagation();
                            }}
                            className="w-10 text-sm font-bold text-slate-900 text-center bg-white border border-emerald-400 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 px-1 py-0.5"
                          />
                        ) : (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingQtyId(item.productId);
                              setEditingQtyValue(String(item.quantity));
                            }}
                            className="w-8 text-sm font-bold text-slate-900 text-center cursor-pointer hover:bg-emerald-50 hover:text-emerald-700 rounded px-1 py-0.5 transition-colors select-none"
                            title="Cliquer pour modifier la quantité"
                          >
                            {item.quantity}
                          </span>
                        )}

                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.productId, 1); }}
                          disabled={(() => {
                            const p = products.find(prod => prod.id === item.productId);
                            return p ? item.quantity >= p.stock : false;
                          })()}
                          className="w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-700 flex items-center justify-center hover:border-emerald-500 hover:text-emerald-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          title="Augmenter la quantité"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <span className="w-20 text-right text-[13px] font-extrabold text-slate-900 shrink-0">{item.total.toFixed(3)}</span>

                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromCart(item.productId); }}
                        className="w-7 h-7 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="Supprimer du panier"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sous-total et remise */}
            <div className="border-t border-slate-100 pt-2 flex flex-col gap-1.5 text-sm shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Sous-total</span>
                <span className="font-bold text-slate-800">{subtotal.toFixed(3)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium flex items-center gap-1.5"><Percent className="w-3.5 h-3.5 text-amber-600" /> Remise ({currency})</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={discountInput}
                  onFocus={(e) => {
                    setIsDiscountFocused(true);
                    e.currentTarget.select();
                  }}
                  onBlur={() => {
                    setIsDiscountFocused(false);
                    const parsed = parseFloat(discountInput) || 0;
                    const rounded = Math.round(parsed * 1000) / 1000;
                    setDiscountInput(rounded === 0 ? '' : rounded.toFixed(3));
                    setDiscount(rounded);
                  }}
                  onChange={(e) => {
                    const value = e.target.value.replace(',', '.');
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setDiscountInput(value);
                      const parsed = parseFloat(value) || 0;
                      setDiscount(Math.round(parsed * 1000) / 1000);
                    }
                  }}
                  placeholder="0.000"
                  className="w-28 text-right px-2 py-1 border border-slate-200 rounded-lg text-sm font-bold text-amber-700 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                />
              </div>
            </div>

            {/* Total à payer */}
            <div className="bg-emerald-50 rounded-xl px-4 py-2 flex items-center justify-between text-emerald-900 shrink-0">
              <span className="font-bold text-sm">Total à payer</span>
              <span className="text-3xl font-extrabold tracking-tight select-all">
                {cartTotal.toFixed(3)} <span className="text-sm font-bold">{currency}</span>
              </span>
            </div>

            {/* Montant reçu + à rendre / reste */}
            <div className="grid grid-cols-2 gap-2 shrink-0">
              <label className="border border-slate-200 rounded-xl px-3 py-2 block focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15 transition-all">
                <span className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  Montant reçu
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setReceivedCash(cartTotal);
                      setReceivedCashInput(cartTotal.toFixed(3));
                    }}
                    className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    Tout payer
                  </button>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={receivedCashInput}
                  onFocus={(e) => {
                    setIsReceivedCashFocused(true);
                    e.currentTarget.select();
                  }}
                  onBlur={() => {
                    setIsReceivedCashFocused(false);
                    const parsed = parseFloat(receivedCashInput) || 0;
                    const rounded = Math.round(parsed * 1000) / 1000;
                    setReceivedCashInput(rounded === 0 ? '' : rounded.toFixed(3));
                    setReceivedCash(rounded);
                  }}
                  onChange={(e) => {
                    const value = e.target.value.replace(',', '.');
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setReceivedCashInput(value);
                      const parsed = parseFloat(value) || 0;
                      setReceivedCash(Math.round(parsed * 1000) / 1000);
                    }
                  }}
                  onKeyDown={(e) => {
                    // Entrée = Encaisser & Valider, même depuis le champ Montant reçu
                    if (e.key === 'Enter' && cart.length > 0 && !isProcessing) {
                      e.preventDefault();
                      const parsed = parseFloat(receivedCashInput) || 0;
                      const rounded = Math.round(parsed * 1000) / 1000;
                      setReceivedCash(rounded);
                      e.currentTarget.blur();
                      validateSale(false);
                    }
                  }}
                  placeholder="0.000"
                  className="w-full bg-transparent text-lg font-extrabold text-slate-900 focus:outline-none p-0"
                />
              </label>
              <div className={cn(
                "border rounded-xl px-3 py-2",
                receivedCash > 0 && receivedCash < cartTotal ? "border-rose-200 bg-rose-50" : "border-slate-200"
              )}>
                <span className={cn(
                  "block text-[11px] font-semibold",
                  receivedCash > 0 && receivedCash < cartTotal ? "text-rose-700" : "text-slate-500"
                )}>
                  {receivedCash > 0 && receivedCash < cartTotal ? 'Reste (dette)' : receivedCash > 0 && receivedCash === cartTotal ? 'Exact' : 'À rendre'}
                </span>
                <span className={cn(
                  "block text-lg font-extrabold",
                  receivedCash > 0 && receivedCash < cartTotal ? "text-rose-700" : "text-emerald-700"
                )}>
                  {receivedCash > cartTotal
                    ? (receivedCash - cartTotal).toFixed(3)
                    : receivedCash > 0 && receivedCash < cartTotal
                      ? (cartTotal - receivedCash).toFixed(3)
                      : '0.000'}
                </span>
              </div>
            </div>

            {/* Actions principales */}
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => validateSale(false)}
                disabled={cart.length === 0 || isProcessing}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[15px] rounded-xl transition-all active:scale-[0.98] disabled:opacity-40 disabled:scale-100 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isProcessing ? 'Traitement...' : (
                  <>
                    <CheckCircle className="w-5 h-5 shrink-0" />
                    Encaisser {cartTotal.toFixed(3)} {currency}
                    <span className="hidden xl:inline text-[10px] font-bold text-emerald-100 border border-emerald-300/70 rounded px-1.5 py-0.5">Entrée</span>
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  if (cart.length === 0) return;
                  if (!selectedClient) {
                    setError('Veuillez sélectionner un client. Un crédit ne peut pas être enregistré pour un client de passage.');
                    return;
                  }
                  setError(null);
                  setCreditPartialInput('');
                  setCreditModalError(null);
                  setIsCreditModalOpen(true);
                }}
                disabled={cart.length === 0 || isProcessing}
                title="Enregistrer la vente en crédit (client requis)"
                className="px-4 py-3 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 font-extrabold text-sm rounded-xl transition-all active:scale-[0.98] disabled:opacity-40 disabled:scale-100 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CreditCard className="w-4 h-4 shrink-0" />
                Crédité
              </button>
            </div>

            {/* Avertissement paiement client de passage */}
            {!selectedClient && Math.abs(paidAmount - cartTotal) > 0.001 && cart.length > 0 && (
              <div className="text-[11px] text-rose-700 font-semibold bg-rose-50 border border-rose-200 rounded-lg p-2 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                <span>Le montant reçu doit correspondre exactement au montant total pour un client de passage.</span>
              </div>
            )}

            {error && (
              <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-1.5 text-rose-700 text-[11px] font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                <span className="leading-tight">{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Credit Sale Modal */}
      {isCreditModalOpen && selectedClient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white p-6 rounded-3xl shadow-2xl max-w-sm w-full border border-gray-100 scale-in duration-200">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-amber-600 shrink-0" />
                  Vente à crédit
                </h3>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Client : <span className="text-gray-800">{selectedClient.name}</span>
                </p>
              </div>
              <button
                onClick={() => setIsCreditModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total de la vente</span>
              <span className="text-lg font-black text-gray-900">{cartTotal.toFixed(3)} {currency}</span>
            </div>

            {/* Option 1 : tout créditer */}
            <button
              onClick={() => {
                setIsCreditModalOpen(false);
                validateSale(true, 0);
              }}
              disabled={isProcessing}
              className="w-full py-2.5 mb-3 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-amber-200 active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CreditCard className="w-4 h-4 shrink-0" />
              Créditer tout le montant
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[10px] font-black text-gray-400 uppercase">ou</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Option 2 : tranche payée + reste en crédit */}
            <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1.5">
              Le client paie une tranche maintenant
            </label>
            <div className="relative mb-2">
              <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                value={creditPartialInput}
                onChange={(e) => {
                  setCreditPartialInput(e.target.value);
                  setCreditModalError(null);
                }}
                placeholder="0.000"
                className="w-full pl-9 pr-14 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-gray-400">{currency}</span>
            </div>

            {(() => {
              const tranche = parseFloat(creditPartialInput) || 0;
              const reste = Math.max(0, Math.round((cartTotal - tranche) * 1000) / 1000);
              return tranche > 0 && tranche < cartTotal ? (
                <p className="text-[11px] font-bold text-gray-500 mb-3">
                  Reste en crédit : <span className="text-amber-600 font-black">{reste.toFixed(3)} {currency}</span>
                </p>
              ) : null;
            })()}

            {creditModalError && (
              <div className="p-2 mb-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-1.5 text-rose-600 text-[11px] font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="leading-tight">{creditModalError}</span>
              </div>
            )}

            <button
              onClick={() => {
                const tranche = parseFloat(creditPartialInput) || 0;
                if (tranche <= 0) {
                  setCreditModalError('Saisissez le montant payé par le client, ou choisissez « Créditer tout le montant ».');
                  return;
                }
                if (tranche >= cartTotal) {
                  setCreditModalError(`La tranche doit être inférieure au total (${cartTotal.toFixed(3)} ${currency}). Pour un paiement complet, utilisez « Encaisser & Valider ».`);
                  return;
                }
                setIsCreditModalOpen(false);
                validateSale(true, tranche);
              }}
              disabled={isProcessing}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CheckCircle className="w-4 h-4 shrink-0" />
              Encaisser la tranche & créditer le reste
            </button>
          </div>
        </div>
      )}

      {/* Success Overlay */}
      {saleSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white p-8 rounded-3xl shadow-2xl text-center max-w-sm w-full border border-gray-100 scale-in duration-200">
            <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">Succès !</h3>
            <p className="text-gray-500 mb-8 font-semibold">{saleSuccess}</p>
            
            <div className="space-y-3">
              {lastInvoice && (
                <button 
                  onClick={handlePrint}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Printer className="w-5 h-5" />
                  Imprimer Ticket
                </button>
              )}
              {lastInvoice && (
                <button 
                  onClick={() => downloadPDF(lastInvoice)}
                  className="w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-3xs"
                >
                  <FileText className="w-5 h-5" />
                  Télécharger Facture PDF
                </button>
              )}
              <button 
                onClick={() => {
                  setSaleSuccess(null);
                  setLastInvoice(null);
                }}
                className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-colors cursor-pointer shadow-sm"
              >
                Nouvelle Vente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
