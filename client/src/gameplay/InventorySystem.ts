// ─── Inventory System ───────────────────────────────────────────────
// Items, inventory management, equipment slots, stack/unstack,
// drag-and-drop ready item data model.

// ── Item Definitions ────────────────────────────────────────────────

export enum ItemCategory {
  Weapon = 'weapon',
  Armor = 'armor',
  Consumable = 'consumable',
  Material = 'material',
  Quest = 'quest',
  Tool = 'tool',
  Key = 'key',
  Misc = 'misc',
}

export enum ItemRarity {
  Common = 'common',
  Uncommon = 'uncommon',
  Rare = 'rare',
  Epic = 'epic',
  Legendary = 'legendary',
}

export interface ItemStat {
  name: string;
  value: number;
}

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  icon?: string; // URL or sprite key
  stackable: boolean;
  maxStack: number;
  value: number; // sale/buy price
  stats?: ItemStat[];
  equipSlot?: EquipSlot;
  /** Custom data for game-specific logic */
  data?: Record<string, any>;
  /** Use callback */
  onUse?: (inventory: Inventory, slotIndex: number) => boolean;
}

export enum EquipSlot {
  Head = 'head',
  Chest = 'chest',
  Legs = 'legs',
  Feet = 'feet',
  MainHand = 'mainHand',
  OffHand = 'offHand',
  Ring1 = 'ring1',
  Ring2 = 'ring2',
  Necklace = 'necklace',
  Back = 'back',
}

// ── Item Registry ───────────────────────────────────────────────────

export class ItemRegistry {
  private static items = new Map<string, ItemDefinition>();

  static register(item: ItemDefinition): void {
    this.items.set(item.id, item);
  }

  static get(id: string): ItemDefinition | undefined {
    return this.items.get(id);
  }

  static getAll(): ItemDefinition[] {
    return Array.from(this.items.values());
  }

  static getByCategory(category: ItemCategory): ItemDefinition[] {
    return this.getAll().filter(i => i.category === category);
  }

  static registerMany(items: ItemDefinition[]): void {
    items.forEach(i => this.register(i));
  }
}

// ── Inventory ───────────────────────────────────────────────────────

export interface InventorySlot {
  itemId: string;
  quantity: number;
}

export class Inventory {
  private slots: (InventorySlot | null)[];
  private equipment = new Map<EquipSlot, InventorySlot>();

  /** Callbacks */
  public onChange: (() => void) | null = null;
  public onItemAdded: ((itemId: string, quantity: number) => void) | null = null;
  public onItemRemoved: ((itemId: string, quantity: number) => void) | null = null;
  public onItemEquipped: ((slot: EquipSlot, itemId: string) => void) | null = null;
  public onItemUnequipped: ((slot: EquipSlot, itemId: string) => void) | null = null;

  constructor(public readonly size: number = 20) {
    this.slots = new Array(size).fill(null);
  }

  /** Try to add an item. Returns quantity that could NOT be added. */
  addItem(itemId: string, quantity: number = 1): number {
    const def = ItemRegistry.get(itemId);
    if (!def) return quantity;

    let remaining = quantity;

    // Stack into existing slots first
    if (def.stackable) {
      for (let i = 0; i < this.slots.length && remaining > 0; i++) {
        const slot = this.slots[i];
        if (slot && slot.itemId === itemId && slot.quantity < def.maxStack) {
          const space = def.maxStack - slot.quantity;
          const add = Math.min(space, remaining);
          slot.quantity += add;
          remaining -= add;
        }
      }
    }

    // Fill empty slots
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = def.stackable ? Math.min(def.maxStack, remaining) : 1;
        this.slots[i] = { itemId, quantity: add };
        remaining -= add;
      }
    }

    const added = quantity - remaining;
    if (added > 0) {
      this.onItemAdded?.(itemId, added);
      this.onChange?.();
    }
    return remaining;
  }

  /** Remove a quantity of an item. Returns amount actually removed. */
  removeItem(itemId: string, quantity: number = 1): number {
    let remaining = quantity;

    for (let i = this.slots.length - 1; i >= 0 && remaining > 0; i--) {
      const slot = this.slots[i];
      if (slot && slot.itemId === itemId) {
        const remove = Math.min(slot.quantity, remaining);
        slot.quantity -= remove;
        remaining -= remove;
        if (slot.quantity <= 0) this.slots[i] = null;
      }
    }

    const removed = quantity - remaining;
    if (removed > 0) {
      this.onItemRemoved?.(itemId, removed);
      this.onChange?.();
    }
    return removed;
  }

  /** Check if inventory has at least this quantity of an item */
  hasItem(itemId: string, quantity: number = 1): boolean {
    return this.countItem(itemId) >= quantity;
  }

  /** Count total quantity of an item */
  countItem(itemId: string): number {
    let count = 0;
    for (const slot of this.slots) {
      if (slot && slot.itemId === itemId) count += slot.quantity;
    }
    return count;
  }

  /** Get slot at index */
  getSlot(index: number): InventorySlot | null {
    return this.slots[index] ?? null;
  }

  /** Swap two slots */
  swapSlots(a: number, b: number): void {
    if (a < 0 || a >= this.size || b < 0 || b >= this.size) return;
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this.onChange?.();
  }

  /** Use an item at a slot index */
  useItem(slotIndex: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot) return false;

    const def = ItemRegistry.get(slot.itemId);
    if (!def?.onUse) return false;

    if (def.onUse(this, slotIndex)) {
      if (def.category === ItemCategory.Consumable) {
        slot.quantity--;
        if (slot.quantity <= 0) this.slots[slotIndex] = null;
        this.onChange?.();
      }
      return true;
    }
    return false;
  }

  /** Equip an item from inventory slot */
  equip(slotIndex: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot) return false;

    const def = ItemRegistry.get(slot.itemId);
    if (!def?.equipSlot) return false;

    // Unequip current if occupied
    const current = this.equipment.get(def.equipSlot);
    if (current) {
      this.equipment.delete(def.equipSlot);
      this.addItem(current.itemId, current.quantity);
      this.onItemUnequipped?.(def.equipSlot, current.itemId);
    }

    // Remove from inventory
    const equipItem: InventorySlot = { itemId: slot.itemId, quantity: 1 };
    slot.quantity--;
    if (slot.quantity <= 0) this.slots[slotIndex] = null;

    this.equipment.set(def.equipSlot, equipItem);
    this.onItemEquipped?.(def.equipSlot, def.id);
    this.onChange?.();
    return true;
  }

  /** Unequip from an equipment slot back to inventory */
  unequip(equipSlot: EquipSlot): boolean {
    const item = this.equipment.get(equipSlot);
    if (!item) return false;

    const leftover = this.addItem(item.itemId, item.quantity);
    if (leftover > 0) return false; // No space

    this.equipment.delete(equipSlot);
    this.onItemUnequipped?.(equipSlot, item.itemId);
    this.onChange?.();
    return true;
  }

  /** Get equipped item in a slot */
  getEquipped(slot: EquipSlot): InventorySlot | null {
    return this.equipment.get(slot) ?? null;
  }

  /** Get all equipped items */
  getAllEquipped(): Map<EquipSlot, InventorySlot> {
    return new Map(this.equipment);
  }

  /** Get total stat from all equipped items */
  getEquipStat(statName: string): number {
    let total = 0;
    for (const [_, equipped] of this.equipment) {
      const def = ItemRegistry.get(equipped.itemId);
      if (def?.stats) {
        const stat = def.stats.find(s => s.name === statName);
        if (stat) total += stat.value;
      }
    }
    return total;
  }

  /** Get all non-empty slots */
  getAllItems(): { index: number; slot: InventorySlot }[] {
    const items: { index: number; slot: InventorySlot }[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) items.push({ index: i, slot: this.slots[i]! });
    }
    return items;
  }

  /** Clear entire inventory */
  clear(): void {
    this.slots.fill(null);
    this.equipment.clear();
    this.onChange?.();
  }

  /** Serialize for save */
  serialize(): object {
    return {
      size: this.size,
      slots: this.slots.map(s => s ? { itemId: s.itemId, quantity: s.quantity } : null),
      equipment: Object.fromEntries(
        Array.from(this.equipment.entries()).map(([k, v]) => [k, { itemId: v.itemId, quantity: v.quantity }]),
      ),
    };
  }

  /** Deserialize from save */
  static deserialize(data: any): Inventory {
    const inv = new Inventory(data.size);
    if (data.slots) {
      for (let i = 0; i < data.slots.length && i < inv.size; i++) {
        inv.slots[i] = data.slots[i] ? { ...data.slots[i] } : null;
      }
    }
    if (data.equipment) {
      for (const [k, v] of Object.entries(data.equipment)) {
        inv.equipment.set(k as EquipSlot, { ...(v as any) });
      }
    }
    return inv;
  }
}

// Helper color for rarity
export function getRarityColor(rarity: ItemRarity): string {
  switch (rarity) {
    case ItemRarity.Common: return '#aaa';
    case ItemRarity.Uncommon: return '#1eff00';
    case ItemRarity.Rare: return '#0070dd';
    case ItemRarity.Epic: return '#a335ee';
    case ItemRarity.Legendary: return '#ff8000';
  }
}

// ─── Crafting System ─────────────────────────────────────────────────

export interface CraftingRecipe {
  id: string;
  name: string;
  ingredients: { itemId: string; quantity: number }[];
  result: { itemId: string; quantity: number };
  /** Crafting time in seconds (0 = instant) */
  craftTime: number;
  /** Required crafting station tag (e.g., 'forge', 'alchemy') */
  station?: string;
}

export class CraftingSystem {
  private recipes = new Map<string, CraftingRecipe>();

  register(recipe: CraftingRecipe): void {
    this.recipes.set(recipe.id, recipe);
  }

  get(id: string): CraftingRecipe | undefined {
    return this.recipes.get(id);
  }

  getAll(): CraftingRecipe[] {
    return [...this.recipes.values()];
  }

  canCraft(recipeId: string, inventory: Inventory): boolean {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return false;
    return recipe.ingredients.every(ing => inventory.hasItem(ing.itemId, ing.quantity));
  }

  craft(recipeId: string, inventory: Inventory): boolean {
    if (!this.canCraft(recipeId, inventory)) return false;
    const recipe = this.recipes.get(recipeId)!;
    for (const ing of recipe.ingredients) inventory.removeItem(ing.itemId, ing.quantity);
    inventory.addItem(recipe.result.itemId, recipe.result.quantity);
    return true;
  }

  getAvailable(inventory: Inventory, station?: string): CraftingRecipe[] {
    return this.getAll().filter(r => {
      if (station && r.station && r.station !== station) return false;
      return this.canCraft(r.id, inventory);
    });
  }
}

// ─── Loot Table System ───────────────────────────────────────────────

export interface LootEntry {
  itemId: string;
  weight: number;
  minQty: number;
  maxQty: number;
}

export interface LootTable {
  id: string;
  entries: LootEntry[];
  rolls: number;
}

export class LootTableSystem {
  private tables = new Map<string, LootTable>();

  register(table: LootTable): void {
    this.tables.set(table.id, table);
  }

  get(id: string): LootTable | undefined {
    return this.tables.get(id);
  }

  /** Roll a loot table, returns item stacks to add to inventory */
  roll(tableId: string): { itemId: string; quantity: number }[] {
    const table = this.tables.get(tableId);
    if (!table || table.entries.length === 0) return [];

    const totalWeight = table.entries.reduce((s, e) => s + e.weight, 0);
    const results: { itemId: string; quantity: number }[] = [];

    for (let r = 0; r < table.rolls; r++) {
      let rand = Math.random() * totalWeight;
      for (const entry of table.entries) {
        rand -= entry.weight;
        if (rand <= 0) {
          const qty = entry.minQty + Math.floor(Math.random() * (entry.maxQty - entry.minQty + 1));
          const existing = results.find(x => x.itemId === entry.itemId);
          if (existing) existing.quantity += qty;
          else results.push({ itemId: entry.itemId, quantity: qty });
          break;
        }
      }
    }

    return results;
  }

  /** Roll and add directly to an inventory */
  rollInto(tableId: string, inventory: Inventory): { itemId: string; quantity: number }[] {
    const items = this.roll(tableId);
    for (const item of items) inventory.addItem(item.itemId, item.quantity);
    return items;
  }
}
