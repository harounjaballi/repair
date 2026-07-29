// ============================================================
//  SmarTech Repair — Types métier (atelier de réparation GSM)
// ============================================================

export interface Category {
  id: string;
  name: string;
  type: 'piece' | 'accessoire' | 'produit' | 'service' | 'autre';
  ownerId?: string;
}

// Produit / pièce détachée / accessoire vendable et/ou stockable
export interface Product {
  id: string;
  name: string;
  category: string;            // ID ou nom de catégorie
  reference?: string;          // Référence pièce détachée
  compatibleModels?: string;   // Modèles compatibles (ex: "iPhone 11, 11 Pro")
  buyPrice: number;
  sellPrice: number;
  barcode?: string;
  stock: number;
  isPart?: boolean;            // true = pièce détachée, false = produit/accessoire
  isService?: boolean;         // true = service (main-d'œuvre) : pas de prix d'achat ni de stock
  lowStockAlert?: number;
  ownerId?: string;
  createdAt?: string;
}

export interface Client {
  id: string;
  code?: string;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  debt: number;
  ownerId?: string;
  createdAt?: string;
}

// ---------- RÉPARATION ----------

export type RepairStatus =
  | 'recu'
  | 'diagnostic'
  | 'en_attente_piece'
  | 'en_cours'
  | 'termine'
  | 'livre'
  | 'irreparable'
  | 'annule';

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  recu: 'Reçu',
  diagnostic: 'Diagnostic',
  en_attente_piece: 'Attente pièce',
  en_cours: 'En cours',
  termine: 'Terminé',
  livre: 'Livré',
  irreparable: 'Irréparable',
  annule: 'Annulé',
};

export interface RepairPart {
  productId: string;
  name: string;
  quantity: number;
  unitBuyPrice: number;
  unitPrice: number;
  total: number;
}

export interface RepairLog {
  date: string;
  status?: RepairStatus;
  note: string;
  by?: string;
}

export interface Repair {
  id: string;
  number: string;
  date: any;
  clientId?: string;
  clientName?: string;
  clientPhone?: string;

  deviceBrand?: string;
  deviceModel?: string;
  imei?: string;
  devicePassword?: string;
  accessories?: string;
  deviceCondition?: string;

  problem: string;
  diagnostic?: string;

  status: RepairStatus;
  technician?: string;

  estimatedCost?: number;
  laborCost?: number;
  parts: RepairPart[];
  total: number;
  paid: number;
  debt: number;

  warrantyDays?: number;
  warrantyUntil?: string;

  deliveredAt?: string;
  logs: RepairLog[];
  invoiceId?: string;

  ownerId?: string;
}

// ---------- VENTE / FACTURE ----------

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Sale {
  id: string;
  date: any;
  clientId?: string;
  clientName?: string;
  total: number;
  paid: number;
  debt: number;
  tva: number;
  discount?: number;
  invoiceId?: string;
  items: SaleItem[];
  ownerId?: string;
}

export interface Invoice {
  id: string;
  number: string;
  type?: 'vente' | 'reparation';
  saleId?: string;
  repairId?: string;
  clientId?: string;
  clientCode?: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  total: number;
  paid: number;
  debt: number;
  tva: number;
  discount?: number;
  date: any;
  items: SaleItem[];
  ownerId?: string;
}

// ---------- UTILISATEURS / PARAMÈTRES ----------

export interface UserProfile {
  uid: string;
  email: string;
  name?: string;
  role: 'admin' | 'user';
  status?: 'active' | 'banned';
  allowedMenus?: string[];
  password?: string;
  securityCode?: string;
  ownerId?: string;
  creatorId?: string;
  createdAt?: string;
}

export interface StoreSettings {
  id: string;
  storeName: string;
  currency: string;
  address?: string;
  phone?: string;
  tva: number;
  tvaEnabled?: boolean;
  defaultWarrantyDays?: number;
  ownerId?: string;
  deleteCode?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  date: string;
  createdAt: any;
  userId: string;
  ownerId?: string;
}
