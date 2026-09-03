import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { CustomerLook } from '../models/CustomerLook.js';
import { User } from '../models/User.js';
import { connectDB, disconnectDB } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Helper to copy existing images & videos into server/uploads
const syncWorkspaceAssets = () => {
  const sourceDir = path.join(__dirname, '..', '..', 'images');
  const targetDir = path.join(__dirname, '..', 'uploads');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (fs.existsSync(sourceDir)) {
    const files = fs.readdirSync(sourceDir);
    files.forEach(file => {
      const srcFile = path.join(sourceDir, file);
      const destFile = path.join(targetDir, file);
      try {
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
        }
      } catch (err) {
        console.warn(`Asset copy notice for ${file}:`, err.message);
      }
    });
  }
};

export const seedInitialDataIfNeeded = async () => {
  try {
    syncWorkspaceAssets();
    const count = await Product.countDocuments();
    if (count > 0) {
      console.log(`📦 Database already populated with ${count} products.`);
      return;
    }
    console.log(`🌱 Empty database detected. Seeding initial catalog...`);
    await runSeed();
  } catch (error) {
    console.error('Error during auto-seed check:', error);
  }
};

export const runSeed = async () => {
  syncWorkspaceAssets();

  // 1. Seed Admin User
  await User.deleteMany({});
  const adminUser = await User.create({
    name: 'Ace Beauty Admin',
    email: 'admin@acebeautybraids.com',
    password: 'AdminPass123!',
    role: 'admin',
    phone: '+44 7700 900077',
  });
  console.log('👤 Admin user seeded: admin@acebeautybraids.com / AdminPass123!');

  // 2. Seed Categories
  await Category.deleteMany({});
  const categoriesData = [
    {
      name: 'Ready-to-Install Boho Crochet Extensions',
      slug: 'ready-to-install-boho-crochet-extensions',
      image: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?auto=format&fit=crop&w=1000&q=80',
      description: 'Handcrafted pre-looped crochet braids featuring ultra-soft human-hair curls for a voluminous, effortless goddess finish.',
    },
    {
      name: 'Premium Boho Ponytail Extensions',
      slug: 'premium-boho-ponytail-extensions',
      image: 'https://images.unsplash.com/photo-1605980776566-0486c3ac7617?auto=format&fit=crop&w=1000&q=80',
      description: 'Sleek drawstring & wrap-around braided ponytails with flowing curl accents. Transform your daily look in under 60 seconds.',
    },
    {
      name: 'Premium Braided Wigs',
      slug: 'premium-braided-wigs',
      image: 'https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?auto=format&fit=crop&w=1000&q=80',
      description: 'Ultra-lightweight HD full lace and front lace braided wigs. Flawless scalp illusion without spending 8 hours in the salon chair.',
    },
    {
      name: 'Exquisite Cap Braided Wigs',
      slug: 'exquisite-cap-braided-wigs',
      image: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1000&q=80',
      description: 'Breathable, flexible cap construction tailored with custom-knotted braids for maximum comfort and everyday elegance.',
    },
  ];

  const createdCategories = await Category.insertMany(categoriesData);
  const catMap = {};
  createdCategories.forEach(c => { catMap[c.slug] = c._id; });
  console.log(`✨ Seeded ${createdCategories.length} categories.`);

  // 3. Seed Products
  await Product.deleteMany({});
  const productsData = [
    {
      name: 'BLONDI MERO',
      slug: 'blondi-mero',
      category: catMap['premium-braided-wigs'],
      description: '• 100% Human Hair Base\n• Boho Bouncy with Bangs\n• Lightweight\n• 5x5 Closure\n• Color: Blonde',
      details: [
        'Ultra-thin Invisible HD Lace for a flawless, natural hairline melt',
        'Pre-plucked natural hairline with bleached micro-knots for maximum realism',
        'Infused with silky, tangle-resistant bohemian curls',
        'Ultra-lightweight cap structure with adjustable elastic support band',
        '100% glueless installation — ready to wear straight out of the box'
      ],
      hairCareTips: [
        'Apply light curl mousse to define and revive curls',
        'Protect with a satin bonnet overnight'
      ],
      price: 110.00,
      discountPrice: 110.00,
      isFeatured: true,
      isNewArrival: true,
      rating: 5.0,
      reviewsCount: 42,
      images: [
        { url: '/uploads/IMG_6920.PNG', alt: 'BLONDI MERO unit front view', isMain: true },
        { url: '/uploads/IMG_6917_2.PNG', alt: 'BLONDI MERO side view' },
        { url: '/uploads/IMG_4065.PNG', alt: 'BLONDI MERO HD lace texture' },
      ],
      videos: [
        { url: '/uploads/BlonDie.mp4', posterUrl: '/uploads/IMG_6920.PNG', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Honey Blonde Mix', color: 'Honey Blonde Mix', capSize: 'Medium (22.5")', stock: 14, sku: 'ABB-BLM-1' },
        { label: '1B/27 Ombre', color: '1B/27 Ombre', capSize: 'Medium (22.5")', stock: 6, sku: 'ABB-BLM-2' },
      ]
    },
    {
      name: 'WIG NAOMI',
      slug: 'wig-naomi',
      category: catMap['exquisite-cap-braided-wigs'],
      description: '• 100% Human Hair Base\n• Boho Bouncy with Bangs\n• Lightweight\n• 5x5 Closure\n• Color: Mixed Brown',
      details: [
        'Premium HD Lace frontal offering an invisible, melted hairline',
        'Glueless secure fit with inner silicone grip band and adjustable straps',
        'Masterfully braided with durable, feather-light luxury fibers',
        'Zero glue or gel required — salon-ready in seconds',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Finger comb curls with a drop of argan oil',
        'Air dry thoroughly after light cleansing'
      ],
      price: 110.00,
      discountPrice: 110.00,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 36,
      images: [
        { url: '/uploads/IMG_6917_2.PNG', alt: 'WIG NAOMI front view', isMain: true },
        { url: '/uploads/IMG_6241.PNG', alt: 'WIG NAOMI detail' },
        { url: '/uploads/IMG_4065.PNG', alt: 'WIG NAOMI HD lace interior' },
      ],
      videos: [
        { url: '/uploads/naomi.mp4', posterUrl: '/uploads/IMG_6917_2.PNG', type: 'video/mp4' }
      ],
      variants: [
        { label: '1B Natural Black', color: '1B Natural Black', capSize: 'Medium (22.5")', stock: 16, sku: 'ABB-WNM-1B-M' },
        { label: '1B/30 Ombre Caramel', color: '1B/30 Ombre Caramel', capSize: 'Medium (22.5")', stock: 9, sku: 'ABB-WNM-30-M' },
      ]
    },
    {
      name: 'WIG LAUREL',
      slug: 'wig-laurel',
      category: catMap['exquisite-cap-braided-wigs'],
      description: '• 100% Human Hair Base\n• Boho Bouncy with Bangs\n• Lightweight\n• 5x5 Closure\n• Color: Black',
      details: [
        'High-definition HD Lace base with invisible scalp melt',
        'Neat micro-braided crown transitioning into a chic front fringe',
        'Ultra-soft, bouncy bohemian curls',
        '100% glueless cap with secure adjustable elastic band',
        'Feather-light density that eliminates neck strain'
      ],
      hairCareTips: [
        'Fluff curls gently with fingers using a light curl mousse',
        'Sleep in a satin bonnet to preserve bounce'
      ],
      price: 110.00,
      discountPrice: 110.00,
      isFeatured: true,
      isNewArrival: true,
      rating: 5.0,
      reviewsCount: 28,
      images: [
        { url: '/uploads/IMG_6920.PNG', alt: 'WIG LAUREL front view', isMain: true },
        { url: '/uploads/IMG_6241.PNG', alt: 'WIG LAUREL texture detail' }
      ],
      variants: [
        { label: '1B Natural Black', color: '1B Natural Black', capSize: 'Medium (22.5")', stock: 12, sku: 'ABB-WGL-1B-M' }
      ]
    },
    {
      name: 'WIG JAY',
      slug: 'wig-jay',
      category: catMap['exquisite-cap-braided-wigs'],
      description: '• 100% Human Hair Base\n• Boho Bouncy with Bangs\n• Lightweight\n• 5x5 Closure\n• Color: Wine',
      details: [
        'Invisible HD Lace for a completely natural, melted appearance',
        'Radiant copper/auburn multi-tonal blend with soft root shading',
        'Full front fringe bangs with soft, bouncy bohemian ringlets',
        'Glueless breathable stretch cap with snug silicone grip band',
        'Pre-styled and ready to wear right out of the luxury box'
      ],
      hairCareTips: [
        'Mist with water and leave-in conditioner to refresh waves',
        'Keep stored in the Ace signature satin bag'
      ],
      price: 110.00,
      discountPrice: 110.00,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 34,
      images: [
        { url: '/uploads/IMG_6917_2.PNG', alt: 'WIG JAY front view', isMain: true },
        { url: '/uploads/IMG_6242.PNG', alt: 'WIG JAY curl texture' }
      ],
      variants: [
        { label: '#350 Copper Rust', color: '#350 Copper Rust', capSize: 'Medium (22.5")', stock: 15, sku: 'ABB-WGJ-350-M' },
        { label: '#30 Auburn Brown', color: '#30 Auburn Brown', capSize: 'Medium (22.5")', stock: 10, sku: 'ABB-WGJ-30-M' }
      ]
    },
    {
      name: 'Wig Aneeta',
      slug: 'wig-aneeta-1',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Ready-to-wear braided scarf wig',
      details: [
        'Ready-to-wear braided scarf wig designed for effortless instant styling',
        'Comfortable, breathable stretch fabric scarf attachment with secure fit',
        'Ultra-lightweight hand-crafted braids with natural movement',
        'Zero glue, gel, or lace cutting required — slip on and go in seconds',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Hand wash scarf band gently with mild detergent and air dry',
        'Store in satin bag to keep braids neat and tangle-free'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 18,
      images: [],
      videos: [
        { url: '/uploads/aneeta.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Flexible Scarf Fit', stock: 20, sku: 'ABB-WGA-STD-1' }
      ]
    },
    {
      name: 'Wig Aneeta',
      slug: 'wig-aneeta-2',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Ready-to-wear braided scarf wig',
      details: [
        'Ready-to-wear braided scarf wig designed for effortless instant styling',
        'Comfortable, breathable stretch fabric scarf attachment with secure fit',
        'Ultra-lightweight hand-crafted braids with natural movement',
        'Zero glue, gel, or lace cutting required — slip on and go in seconds',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Hand wash scarf band gently with mild detergent and air dry',
        'Store in satin bag to keep braids neat and tangle-free'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 18,
      images: [],
      videos: [
        { url: '/uploads/aneeta2.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Flexible Scarf Fit', stock: 20, sku: 'ABB-WGA-STD-2' }
      ]
    },
    {
      name: 'Wig Aneeta',
      slug: 'wig-aneeta-3',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Ready-to-wear braided scarf wig',
      details: [
        'Ready-to-wear braided scarf wig designed for effortless instant styling',
        'Comfortable, breathable stretch fabric scarf attachment with secure fit',
        'Ultra-lightweight hand-crafted braids with natural movement',
        'Zero glue, gel, or lace cutting required — slip on and go in seconds',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Hand wash scarf band gently with mild detergent and air dry',
        'Store in satin bag to keep braids neat and tangle-free'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 18,
      images: [],
      videos: [
        { url: '/uploads/aneeta3.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Flexible Scarf Fit', stock: 20, sku: 'ABB-WGA-STD-3' }
      ]
    },
    {
      name: 'Wig Tara',
      slug: 'wig-tara-1',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Ready-to-wear braided cap wig',
      details: [
        'Ready-to-wear braided cap wig tailored for quick, protective daily styling',
        'Breathable, elastic baseball/sun cap base with secure adjustable strap',
        'Feather-light braided extensions seamlessly attached around the perimeter',
        'Zero adhesive needed — beginner-friendly 30-second wear',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Gently wipe cap interior and air dry after workouts or daily wear',
        'Lightly oil braided strands to maintain sheen and prevent frizz'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 22,
      images: [],
      videos: [
        { url: '/uploads/wigtara.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Adjustable Cap Fit', stock: 20, sku: 'ABB-WGT-STD-1' }
      ]
    },
    {
      name: 'Wig Tara',
      slug: 'wig-tara-2',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Ready-to-wear braided cap wig',
      details: [
        'Ready-to-wear braided cap wig tailored for quick, protective daily styling',
        'Breathable, elastic baseball/sun cap base with secure adjustable strap',
        'Feather-light braided extensions seamlessly attached around the perimeter',
        'Zero adhesive needed — beginner-friendly 30-second wear',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Gently wipe cap interior and air dry after workouts or daily wear',
        'Lightly oil braided strands to maintain sheen and prevent frizz'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 22,
      images: [],
      videos: [
        { url: '/uploads/wigtara2.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Adjustable Cap Fit', stock: 20, sku: 'ABB-WGT-STD-2' }
      ]
    },
    {
      name: 'Wig Tara',
      slug: 'wig-tara-3',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Ready-to-wear braided cap wig',
      details: [
        'Ready-to-wear braided cap wig tailored for quick, protective daily styling',
        'Breathable, elastic baseball/sun cap base with secure adjustable strap',
        'Feather-light braided extensions seamlessly attached around the perimeter',
        'Zero adhesive needed — beginner-friendly 30-second wear',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Gently wipe cap interior and air dry after workouts or daily wear',
        'Lightly oil braided strands to maintain sheen and prevent frizz'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 22,
      images: [],
      videos: [
        { url: '/uploads/wigtara3.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Adjustable Cap Fit', stock: 20, sku: 'ABB-WGT-STD-3' }
      ]
    },
    {
      name: 'Wig Chioma',
      slug: 'wig-chioma',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Ready-to-wear braided bucket cap wig',
      details: [
        'Ready-to-wear braided bucket cap wig combining trendy streetwear with instant glam',
        'Built-in structured bucket hat base for all-day comfort and sun protection',
        'Lightweight, neatly braided extensions securely integrated into the rim',
        '100% glueless installation — ready to wear straight out of the box',
        'Includes signature Ace protective storage bag'
      ],
      hairCareTips: [
        'Spot clean bucket cap exterior with a damp cloth',
        'Store inside satin bag to retain shape'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.8,
      reviewsCount: 15,
      images: [],
      videos: [
        { url: '/uploads/wigchioma.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Universal Bucket Fit', stock: 20, sku: 'ABB-WGC-STD' }
      ]
    },
    {
      name: 'Wig Sharon',
      slug: 'wig-sharon-1',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'ready to wear braided head warmer wig',
      details: [
        'Ready to wear braided head warmer wig designed for cozy comfort and effortless instant styling',
        'Soft, stretch head warmer headband base with secure fit',
        'Ultra-lightweight hand-crafted braids with natural movement',
        'Zero glue, gel, or lace cutting required — slip on and go in seconds',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Hand wash head warmer band gently with mild detergent and air dry',
        'Store in satin bag to keep braids neat and tangle-free'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 20,
      images: [],
      videos: [
        { url: '/uploads/sharon.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Flexible Head Warmer Fit', stock: 20, sku: 'ABB-WGS-STD-1' }
      ]
    },
    {
      name: 'Wig Sharon',
      slug: 'wig-sharon-2',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'ready to wear braided head warmer wig',
      details: [
        'Ready to wear braided head warmer wig designed for cozy comfort and effortless instant styling',
        'Soft, stretch head warmer headband base with secure fit',
        'Ultra-lightweight hand-crafted braids with natural movement',
        'Zero glue, gel, or lace cutting required — slip on and go in seconds',
        'Includes signature Ace satin protective storage bag'
      ],
      hairCareTips: [
        'Hand wash head warmer band gently with mild detergent and air dry',
        'Store in satin bag to keep braids neat and tangle-free'
      ],
      price: 19.99,
      discountPrice: 19.99,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 20,
      images: [],
      videos: [
        { url: '/uploads/sharon2.mp4', type: 'video/mp4' }
      ],
      variants: [
        { label: 'Natural Black', color: 'Natural Black', capSize: 'Flexible Head Warmer Fit', stock: 20, sku: 'ABB-WGS-STD-2' }
      ]
    }
  ];

  const createdProducts = await Product.insertMany(productsData);
  console.log(`✨ Seeded ${createdProducts.length} luxury hair products.`);

  // 4. Seed Customer Looks (homepage video carousel)
  await CustomerLook.deleteMany({});
  const looksData = [
    {
      title: 'Knotless Goddess in London',
      customerName: 'Tiwa A. (London, UK)',
      videoUrl: '/uploads/shop1.MP4',
      linkedProduct: createdProducts[0]._id,
      order: 1,
      isActive: true,
    },
    {
      title: 'Boho Crochet Glam in Berlin',
      customerName: 'Chiamaka E. (Berlin, DE)',
      videoUrl: '/uploads/shop2.MP4',
      linkedProduct: createdProducts[1]._id,
      order: 2,
      isActive: true,
    },
    {
      title: '60-Sec Sleek Ponytail Magic',
      customerName: 'Sophie M. (Manchester, UK)',
      videoUrl: '/uploads/shop3.MP4',
      linkedProduct: createdProducts[2]._id,
      order: 3,
      isActive: true,
    },
    {
      title: 'Royal Cap Everyday Glow',
      customerName: 'Keisha D. (Birmingham, UK)',
      videoUrl: '/uploads/shop4.MP4',
      linkedProduct: createdProducts[3]._id,
      order: 4,
      isActive: true,
    },
  ];

  await CustomerLook.insertMany(looksData);
  console.log(`✨ Seeded ${looksData.length} customer looks video carousel entries.`);

  console.log('🎉 AceBeautyBraids seed completed successfully!');
};

// If run directly: node config/seed.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      await connectDB();
      await runSeed();
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      console.error('Seed script error:', err);
      process.exit(1);
    }
  })();
}
