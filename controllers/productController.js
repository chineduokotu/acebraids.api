import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { adjustStockDirectly, logStockAdjustment, withInventoryTransaction } from '../services/inventoryService.js';

const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

const validateInventoryInput = (input, label = 'Product') => {
  for (const field of ['stock', 'lowStockThreshold']) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if ((typeof value !== 'number' && typeof value !== 'string') ||
        (typeof value === 'string' && !value.trim()) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
      throw invalid(`${label} ${field === 'stock' ? 'stock' : 'low-stock threshold'} must be a non-negative whole number.`);
    }
  }
  if (input.variants !== undefined) {
    if (!Array.isArray(input.variants)) throw invalid('Product variants must be an array.');
    const identifiers = new Set();
    input.variants.forEach((variant, index) => {
      if (!variant || typeof variant !== 'object') throw invalid(`Variant ${index + 1} is invalid.`);
      validateInventoryInput(variant, `Variant ${index + 1}`);
      if (variant._id) {
        if (identifiers.has(String(variant._id))) throw invalid('Each variant must have a unique identifier.');
        identifiers.add(String(variant._id));
      }
    });
  }
};

const inventoryEntries = (product) => new Map([
  ['product', { stock: product?.stock ?? 0 }],
  ...(product?.variants || []).map((variant) => [String(variant._id), {
    stock: variant.stock ?? 0,
    variantId: variant._id,
    variantSku: variant.sku || '',
    variantLabel: variant.label || variant.color || '',
  }]),
]);

const logProductStockChanges = async (previous, product, performedBy, session) => {
  const before = inventoryEntries(previous);
  const after = inventoryEntries(product);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldEntry = before.get(key);
    const newEntry = after.get(key);
    const previousStock = oldEntry?.stock ?? 0;
    const newStock = newEntry?.stock ?? 0;
    if (previousStock === newStock) continue;
    const { stock, ...variant } = newEntry || oldEntry;
    await logStockAdjustment({
      product: product._id,
      ...variant,
      changeType: previous ? 'admin_adjustment' : 'manual_restock',
      previousStock,
      newStock,
      quantityDelta: newStock - previousStock,
      performedBy,
      notes: previous ? 'Admin product inventory edit' : 'Initial product inventory',
    }, { session });
  }
};

const checkInventorySnapshot = (product, body) => {
  if (body.expectedUpdatedAt !== undefined &&
      new Date(body.expectedUpdatedAt).getTime() !== product.updatedAt?.getTime()) {
    throw invalid('This product changed while you were editing. Reload it before saving your changes.', 409);
  }
  if (body.inventorySnapshot !== undefined) {
    const snapshot = body.inventorySnapshot;
    if (!snapshot || !Array.isArray(snapshot.variants)) throw invalid('The inventory snapshot is invalid.');
    const actual = inventoryEntries(product);
    const expected = inventoryEntries(snapshot);
    if (actual.size !== expected.size || [...actual].some(([key, value]) => expected.get(key)?.stock !== value.stock)) {
      throw invalid('Stock changed while you were editing. Reload the product before adjusting inventory.', 409);
    }
  }
};

// @desc    Get all products with filtering, search and sorting
// @route   GET /api/products
// @access  Public
export const getProducts = async (req, res) => {
  try {
    const { category, search, sort, isFeatured, isNewArrival, limit = 50, page = 1 } = req.query;

    const query = {};

    if (category) {
      // Find category by slug or id
      const catDoc = await Category.findOne({
        $or: [{ slug: category.toLowerCase() }, { _id: category.match(/^[0-9a-fA-F]{24}$/) ? category : null }]
      });
      if (catDoc) {
        query.category = catDoc._id;
      }
    }

    if (isFeatured === 'true') {
      query.isFeatured = true;
    }

    if (isNewArrival === 'true') {
      query.isNewArrival = true;
    }

    if (search?.trim()) {
      const searchPattern = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingCategories = await Category.find({
        $or: [
          { name: { $regex: searchPattern, $options: 'i' } },
          { slug: { $regex: searchPattern, $options: 'i' } },
        ],
      }).select('_id');

      query.$or = [
        { name: { $regex: searchPattern, $options: 'i' } },
        { slug: { $regex: searchPattern, $options: 'i' } },
        { description: { $regex: searchPattern, $options: 'i' } },
        { details: { $regex: searchPattern, $options: 'i' } },
        { hairCareTips: { $regex: searchPattern, $options: 'i' } },
        { 'variants.label': { $regex: searchPattern, $options: 'i' } },
        { 'variants.color': { $regex: searchPattern, $options: 'i' } },
        { 'variants.sku': { $regex: searchPattern, $options: 'i' } },
      ];

      if (matchingCategories.length > 0) {
        query.$or.push({ category: { $in: matchingCategories.map(category => category._id) } });
      }
    }

    let sortOptions = { createdAt: -1 };
    if (sort === 'price_asc') sortOptions = { price: 1 };
    if (sort === 'price_desc') sortOptions = { price: -1 };
    if (sort === 'rating') sortOptions = { rating: -1 };
    if (sort === 'name_asc') sortOptions = { name: 1 };

    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('category', 'name slug image')
        .sort(sortOptions)
        .skip(skip)
        .limit(Number(limit)),
      Product.countDocuments(query),
    ]);

    res.json({
      products,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single product by slug
// @route   GET /api/products/:slug
// @access  Public
export const getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug })
      .populate('category', 'name slug image');

    if (!product) {
      // Check if param is an ID as fallback
      if (req.params.slug.match(/^[0-9a-fA-F]{24}$/)) {
        const prodById = await Product.findById(req.params.slug).populate('category', 'name slug image');
        if (prodById) return res.json(prodById);
      }
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single product by ID
// @route   GET /api/products/id/:id
// @access  Public
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name slug image');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
export const createProduct = async (req, res) => {
  try {
    validateInventoryInput(req.body);
    const {
      name,
      slug,
      category,
      description,
      details,
      hairCareTips,
      price,
      discountPrice,
      variants,
      images,
      videos,
      isFeatured,
      isNewArrival,
      isSoldOut,
      stock,
      lowStockThreshold,
    } = req.body;

    const generatedSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const createdProduct = await withInventoryTransaction(async (session) => {
      const existingProduct = await Product.findOne({ slug: generatedSlug }).session(session);
      const finalSlug = existingProduct ? `${generatedSlug}-${Date.now()}` : generatedSlug;
      const product = new Product({
        name,
        slug: finalSlug,
        category,
        description,
        details: details || [],
        hairCareTips: hairCareTips || [],
        price: Number(price),
        discountPrice: discountPrice ? Number(discountPrice) : undefined,
        variants: variants || [],
        images: images || [],
        videos: videos || [],
        isFeatured: Boolean(isFeatured),
        isNewArrival: Boolean(isNewArrival),
        isSoldOut: Boolean(isSoldOut),
        stock,
        lowStockThreshold,
      });
      await product.save({ session });
      await logProductStockChanges(null, product, req.user?._id, session);
      if (category) {
        await Category.findByIdAndUpdate(category, { $inc: { itemCount: 1 } }, { session });
      }
      return product;
    });

    res.status(201).json(createdProduct);
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
export const updateProduct = async (req, res) => {
  try {
    validateInventoryInput(req.body);
    const {
      name,
      slug,
      category,
      description,
      details,
      hairCareTips,
      price,
      discountPrice,
      variants,
      images,
      videos,
      isFeatured,
      isNewArrival,
      isSoldOut,
      stock,
      lowStockThreshold,
    } = req.body;

    const updatedProduct = await withInventoryTransaction(async (session) => {
      const product = await Product.findById(req.params.id).session(session);
      if (!product) throw invalid('Product not found', 404);
      checkInventorySnapshot(product, req.body);
      const previous = product.toObject();

      if (name) product.name = name;
      if (slug) product.slug = slug;
      if (category) product.category = category;
      if (description) product.description = description;
      if (details !== undefined) product.details = details;
      if (hairCareTips !== undefined) product.hairCareTips = hairCareTips;
      if (price !== undefined) product.price = Number(price);
      if (discountPrice !== undefined) product.discountPrice = discountPrice ? Number(discountPrice) : undefined;
      if (variants !== undefined) {
        // Partial variant edits retain stock and thresholds that were not supplied.
        product.variants = variants.map((variant) => {
          const existing = variant._id && product.variants.id(variant._id);
          return existing ? { ...existing.toObject(), ...variant } : variant;
        });
      }
      if (images !== undefined) product.images = images;
      if (videos !== undefined) product.videos = videos;
      if (isFeatured !== undefined) product.isFeatured = Boolean(isFeatured);
      if (isNewArrival !== undefined) product.isNewArrival = Boolean(isNewArrival);
      if (isSoldOut !== undefined) product.isSoldOut = Boolean(isSoldOut);
      if (stock !== undefined) product.stock = Number(stock);
      if (lowStockThreshold !== undefined) product.lowStockThreshold = Number(lowStockThreshold);

      await product.save({ session });
      await logProductStockChanges(previous, product, req.user?._id, session);
      return product;
    });
    res.json(updatedProduct);
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
};

// @desc    Adjust one product or variant's inventory
// @route   PATCH /api/products/:id/stock
// @access  Private/Admin
export const updateProductStock = async (req, res) => {
  try {
    validateInventoryInput(req.body);
    if (req.body.stock === undefined && req.body.lowStockThreshold === undefined) {
      throw invalid('Provide a stock quantity or low-stock threshold.');
    }
    if (req.body.expectedStock !== undefined) validateInventoryInput({ stock: req.body.expectedStock });
    const product = await adjustStockDirectly({
      productId: req.params.id,
      variantId: req.body.variantId || null,
      newStock: req.body.stock === undefined ? undefined : Number(req.body.stock),
      lowStockThreshold: req.body.lowStockThreshold === undefined ? undefined : Number(req.body.lowStockThreshold),
      expectedStock: req.body.expectedStock === undefined ? undefined : Number(req.body.expectedStock),
      performedBy: req.user._id,
      notes: typeof req.body.notes === 'string' ? req.body.notes : '',
    });
    res.json(product);
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const catId = product.category;
    await product.deleteOne();

    if (catId) {
      await Category.findByIdAndUpdate(catId, { $inc: { itemCount: -1 } });
    }

    res.json({ message: 'Product removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
