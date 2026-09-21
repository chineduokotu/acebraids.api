import mongoose from 'mongoose';
import { findMatchingVariant, validateItemsStock } from './inventoryService.js';

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const toMinor = (value) => Math.round(value * 100);

// Catalogue prices are GBP. Match the storefront's existing fixed EUR pricing.
// Client-supplied prices, shipping fees, names, and totals never authorize payment.
export const priceStripeOrder = async (draft) => {
  if (!draft || !Array.isArray(draft.items) || !draft.items.length || draft.items.length > 100) {
    throw invalid('Provide between 1 and 100 cart items.');
  }
  const currency = typeof draft.currency === 'string' ? draft.currency.toUpperCase() : 'GBP';
  if (!['GBP', 'EUR'].includes(currency)) throw invalid('Choose GBP or EUR for checkout.');
  const guest = draft.guestInfo;
  const address = guest?.shippingAddress;
  for (const value of [guest?.firstName, guest?.lastName, guest?.email, address?.street, address?.city, address?.postalCode]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 254) throw invalid('Provide a valid shipping contact and address.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email) || !['United Kingdom', 'Germany'].includes(address.country)) {
    throw invalid('Provide a valid email and a shipping address in the United Kingdom or Germany.');
  }
  for (const item of draft.items) {
    if (!item || typeof item.product !== 'string' || !mongoose.isObjectIdOrHexString(item.product) || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100) {
      throw invalid('Each cart item needs a valid product and a quantity between 1 and 100.');
    }
  }
  const { catalogue } = await validateItemsStock(draft.items);
  let subtotalGbpMinor = 0;
  const items = draft.items.map((item) => {
    const product = catalogue.get(item.product);
    if (!product || product.isSoldOut) throw invalid('A product in your cart is unavailable. Please review your bag.');
    let variant;
    if (product.variants.length) {
      variant = findMatchingVariant(product, item.variant, item.variantId);
      if (!variant) throw invalid('A selected product option is unavailable. Please review your bag.');
    }
    const price = variant?.priceOverride ?? product.discountPrice ?? product.price;
    if (!Number.isFinite(price) || price < 0) throw invalid('A product price is unavailable.');
    const gbpMinor = toMinor(price);
    const unitMinor = currency === 'EUR' ? Math.round(gbpMinor * 1.18) : gbpMinor;
    subtotalGbpMinor += gbpMinor * item.qty;
    return {
      product: product._id, name: product.name, slug: product.slug,
      image: product.images[0]?.url || '',
      variant: variant ? { _id: variant._id, label: variant.label, color: variant.color, length: variant.length, capSize: variant.capSize, sku: variant.sku } : {},
      qty: item.qty, price: unitMinor / 100,
    };
  });
  const subtotalMinor = items.reduce((sum, item) => sum + toMinor(item.price) * item.qty, 0);
  const shippingGbpMinor = 0; // Free shipping on all orders
  const shippingMinor = 0;
  const amountMinor = subtotalMinor + shippingMinor;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 50 || amountMinor > 99_999_999) throw invalid('The order total is outside the supported payment range.');
  return {
    items, currency, subtotal: subtotalMinor / 100, shippingFee: shippingMinor / 100,
    total: amountMinor / 100, stripeExpectedAmountMinor: amountMinor,
    guestInfo: {
      firstName: guest.firstName.trim(), lastName: guest.lastName.trim(), email: guest.email.trim(),
      phone: typeof guest.phone === 'string' ? guest.phone.slice(0, 50) : '',
      shippingAddress: {
        street: address.street.trim(), apartment: typeof address.apartment === 'string' ? address.apartment.slice(0, 254) : '',
        city: address.city.trim(), postalCode: address.postalCode.trim(), country: address.country,
      },
    },
  };
};
