import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';

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
    } = req.body;

    const generatedSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const existingProduct = await Product.findOne({ slug: generatedSlug });
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
    });

    const createdProduct = await product.save();
    
    // Update category item count
    if (category) {
      await Category.findByIdAndUpdate(category, { $inc: { itemCount: 1 } });
    }

    res.status(201).json(createdProduct);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

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
    } = req.body;

    if (name) product.name = name;
    if (slug) product.slug = slug;
    if (category) product.category = category;
    if (description) product.description = description;
    if (details !== undefined) product.details = details;
    if (hairCareTips !== undefined) product.hairCareTips = hairCareTips;
    if (price !== undefined) product.price = Number(price);
    if (discountPrice !== undefined) product.discountPrice = discountPrice ? Number(discountPrice) : undefined;
    if (variants !== undefined) product.variants = variants;
    if (images !== undefined) product.images = images;
    if (videos !== undefined) product.videos = videos;
    if (isFeatured !== undefined) product.isFeatured = Boolean(isFeatured);
    if (isNewArrival !== undefined) product.isNewArrival = Boolean(isNewArrival);
    if (isSoldOut !== undefined) product.isSoldOut = Boolean(isSoldOut);

    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (error) {
    res.status(400).json({ message: error.message });
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
