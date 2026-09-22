import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { InventoryLog } from '../models/InventoryLog.js';

const invalid = (message, status = 400, code = 'INVALID_INVENTORY') => Object.assign(new Error(message), { status, code });
const stockValue = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const objectId = (value) => value?._id || value;

// All items, the order marker, and the audit trail commit together. The driver
// retries write conflicts; there is deliberately no unsafe standalone fallback.
export const withInventoryTransaction = async (work, existingSession = null) => {
  if (existingSession) return work(existingSession);
  try {
    return await mongoose.connection.transaction(work, {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error.code === 20 || error.codeName === 'IllegalOperation') {
      throw invalid('Inventory updates require MongoDB Atlas or a MongoDB replica set.', 503, 'INVENTORY_DATABASE_CONFIGURATION');
    }
    throw error;
  }
};

export const findMatchingVariant = (product, itemVariant, variantId) => {
  const variants = product?.variants || [];
  if (!variants.length) return null;
  const id = variantId || itemVariant?._id;
  if (id) return variants.find((variant) => String(variant._id) === String(id)) || null;
  if (itemVariant?.sku) return variants.find((variant) => variant.sku === itemVariant.sku) || null;
  const keys = ['label', 'color', 'length', 'capSize'].filter((key) => itemVariant?.[key]);
  if (!keys.length) return variants.length === 1 ? variants[0] : null;
  const matches = variants.filter((variant) => keys.every((key) => variant[key] === itemVariant[key]));
  return matches.length === 1 ? matches[0] : null;
};

const stockError = (product, variant, available, status = 400) => {
  const variantLabel = variant ? ' in the selected option' : '';
  if (available <= 0) {
    return invalid(
      'Sorry, \"' + product.name + '\"' + variantLabel + ' is currently out of stock. Please choose another available option or check back soon.',
      status, 'INSUFFICIENT_STOCK'
    );
  }
  return invalid(
    'Only ' + available + ' ' + (available === 1 ? 'item' : 'items') + ' of \"' + product.name + '\"' + variantLabel +
    ' are currently available. Please update the quantity to continue.',
    status, 'INSUFFICIENT_STOCK'
  );
};

export const validateItemsStock = async (items, { session = null } = {}) => {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw invalid('Provide between 1 and 100 cart items.');
  for (const item of items) {
    if (!item || !mongoose.isObjectIdOrHexString(objectId(item.product)) || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 100) {
      throw invalid('Each cart item needs a valid product and a quantity between 1 and 100.');
    }
  }
  const products = await Product.find({ _id: { $in: items.map((item) => objectId(item.product)) } }).session(session);
  const catalogue = new Map(products.map((product) => [String(product._id), product]));
  const quantities = new Map();
  for (const item of items) {
    const product = catalogue.get(String(objectId(item.product)));
    if (!product) throw invalid('A product in your cart could not be found.', 400, 'INVENTORY_ITEM_UNAVAILABLE');
    const variant = findMatchingVariant(product, item.variant, item.variantId);
    if (product.variants?.length && !variant) throw invalid(
      'Sorry, the selected option for \"' + product.name + '\" is no longer available. Please choose another option to continue.',
      400, 'INVENTORY_ITEM_UNAVAILABLE'
    );

    const key = String(product._id) + ':' + (variant?._id || 'base');
    const qty = (quantities.get(key)?.qty || 0) + item.qty;
    const available = product.isSoldOut ? 0 : stockValue(variant ? variant.stock : product.stock);
    if (qty > available) throw stockError(product, variant, available);
    quantities.set(key, { product, variant, qty });
  }
  return { valid: true, catalogue, allocations: [...quantities.values()] };
};

export const logStockAdjustment = async (log, { session = null } = {}) => {
  const [entry] = await InventoryLog.create([{ ...log, sku: log.sku || log.variantSku || '' }], { session });
  return entry;
};

export const deductOrderStock = async (order, { reason = 'customer_purchase', performedBy = null, session = null } = {}) => {
  const result = await withInventoryTransaction(async (transaction) => {
    const stored = await Order.findById(order?._id).session(transaction);
    if (!stored) throw invalid('Order not found.', 404);
    if (stored.inventoryState === 'deducted') return { success: true, updatedCount: 0, allocations: stored.stockAllocations };
    if (stored.inventoryState === 'restored' || stored.orderStatus === 'cancelled') throw invalid('A cancelled order cannot deduct stock.', 409);
    const { allocations } = await validateItemsStock(stored.items, { session: transaction });
    const movements = [];
    for (const { product, variant, qty } of allocations) {
      // Bind the ID and stock condition to the SAME array element.
      const filter = variant ? { _id: product._id, isSoldOut: { $ne: true }, variants: { $elemMatch: { _id: variant._id, stock: { $gte: qty } } } } :
        { _id: product._id, isSoldOut: { $ne: true }, stock: { $gte: qty } };
      const updated = await Product.findOneAndUpdate(filter, { $inc: { [variant ? 'variants.$.stock' : 'stock']: -qty } }, { new: true, session: transaction });
      if (!updated) throw stockError(product, variant, 0, 409);
      const newStock = variant ? updated.variants.id(variant._id).stock : updated.stock;
      const movement = { product: product._id, variantId: variant?._id, variantLabel: variant?.label || variant?.color || '', sku: variant?.sku || '', qty };
      movements.push(movement);
      await logStockAdjustment({ ...movement, variantSku: movement.sku, changeType: reason, quantityDelta: -qty,
        previousStock: newStock + qty, newStock, order: stored._id, performedBy,
        notes: 'Purchase for order ' + (stored.trackingCode || stored.paymentRef) }, { session: transaction });
    }
    await Order.updateOne({ _id: stored._id }, { $set: { inventoryState: 'deducted', stockAllocations: movements, inventoryError: '' } }, { session: transaction });
    return { success: true, updatedCount: movements.length, allocations: movements };
  }, session);
  order.inventoryState = 'deducted';
  order.stockAllocations = result.allocations;
  order.inventoryError = '';
  return result;
};

export const restoreOrderStock = async (order, { reason = 'order_cancellation', performedBy = null, session = null } = {}) => {
  const result = await withInventoryTransaction(async (transaction) => {
    const stored = await Order.findById(order?._id).session(transaction);
    if (!stored) throw invalid('Order not found.', 404);
    // Never manufacture stock for an order without a recorded deduction.
    if (stored.inventoryState !== 'deducted') return { success: true, restoredCount: 0, state: stored.inventoryState };
    for (const allocation of stored.stockAllocations) {
      const variant = allocation.variantId;
      const filter = { _id: allocation.product, ...(variant ? { 'variants._id': variant } : { 'variants.0': { $exists: false } }) };
      const updated = await Product.findOneAndUpdate(filter, { $inc: { [variant ? 'variants.$.stock' : 'stock']: allocation.qty } }, { new: true, session: transaction });
      if (!updated) throw invalid('An ordered product or option was removed. Restore it before cancelling this order.', 409, 'INVENTORY_ITEM_UNAVAILABLE');
      const newStock = variant ? updated.variants.id(variant).stock : updated.stock;
      await logStockAdjustment({ product: allocation.product, variantId: variant, variantLabel: allocation.variantLabel,
        variantSku: allocation.sku, changeType: reason, quantityDelta: allocation.qty,
        previousStock: newStock - allocation.qty, newStock, order: stored._id, performedBy,
        notes: 'Restored for order ' + (stored.trackingCode || stored.paymentRef) }, { session: transaction });
    }
    await Order.updateOne({ _id: stored._id }, { $set: { inventoryState: 'restored', inventoryError: '' } }, { session: transaction });
    return { success: true, restoredCount: stored.stockAllocations.length, state: 'restored' };
  }, session);
  order.inventoryState = result.state;
  return result;
};

export const adjustStockDirectly = async ({ productId, variantId = null, newStock, lowStockThreshold,
  expectedStock, performedBy = null, notes = '', changeType = 'admin_adjustment', session = null }) => {
  for (const [name, value] of [['Stock', newStock], ['Low stock threshold', lowStockThreshold], ['Expected stock', expectedStock]]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw invalid(name + ' must be a non-negative whole number.');
  }
  if (newStock === undefined && lowStockThreshold === undefined) throw invalid('Provide stock or a low stock threshold.');
  return withInventoryTransaction(async (transaction) => {
    const product = await Product.findById(productId).session(transaction);
    if (!product) throw invalid('Product not found.', 404);
    if (product.variants.length && !variantId) throw invalid('Select a variant to adjust its stock.');
    const variant = variantId ? product.variants.id(variantId) : null;
    if (variantId && !variant) throw invalid('Variant not found.', 404);
    const target = variant || product;
    const previousStock = target.stock;
    if (expectedStock !== undefined && previousStock !== expectedStock) throw invalid('Stock changed while you were editing. Refresh and try again.', 409);
    if (newStock !== undefined) target.stock = newStock;
    if (lowStockThreshold !== undefined) target.lowStockThreshold = lowStockThreshold;
    if (newStock > previousStock) product.isSoldOut = false;
    await product.save({ session: transaction });
    if (target.stock !== previousStock) await logStockAdjustment({ product: product._id, variantId: variant?._id,
      variantSku: variant?.sku || '', variantLabel: variant?.label || variant?.color || '', changeType,
      quantityDelta: target.stock - previousStock, previousStock, newStock: target.stock, performedBy,
      notes: notes || 'Admin manual stock adjustment' }, { session: transaction });
    return product;
  }, session);
};

