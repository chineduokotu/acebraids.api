import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { CustomerLook } from '../models/CustomerLook.js';
import { User } from '../models/User.js';
import { connectDB, disconnectDB } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      name: 'Empress Island Boho Knotless Braided Wig',
      slug: 'empress-island-boho-knotless-braided-wig',
      category: catMap['premium-braided-wigs'],
      description: 'Our crown jewel. 100% hand-braided HD swiss lace knotless braids infused with luxury French human hair curls. Ultra-lightweight on the scalp with pre-plucked natural hairline and subtle baby hairs.',
      details: [
        'Full HD Transparent Lace for invisible melt',
        'Pre-plucked natural hairline with bleached micro-knots',
        'Weighs less than 420g — zero neck tension',
        'Comes with adjustable elastic band and inner combs',
        'Tangle-resistant premium human curl blend'
      ],
      hairCareTips: [
        'Apply a lightweight foam mousse weekly to maintain curls',
        'Sleep with a silk or satin bonnet',
        'Wash gently with sulfate-free shampoo in lukewarm water'
      ],
      price: 245.00,
      discountPrice: 219.00,
      isFeatured: true,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 38,
      images: [
        { url: '/uploads/IMG_6920.PNG', alt: 'Empress Island Boho Knotless Wig front view', isMain: true },
        { url: '/uploads/IMG_6917_2.PNG', alt: 'Model wearing Boho Knotless Braids' },
        { url: '/uploads/IMG_4065.PNG', alt: 'Scalp lace detail' },
      ],
      videos: [
        { url: '/uploads/2b96717a-1b2c-4f17-9375-e1234043a67a.MP4', posterUrl: '/uploads/IMG_6920.PNG', type: 'video/mp4' }
      ],
      variants: [
        { label: '1B Natural Black / 30 Inch', color: '1B Natural Black', length: '30 Inch', capSize: 'Medium (22.5")', stock: 12, sku: 'ABB-EIB-1B-30-M' },
        { label: '1B/30 Ombre Honey / 30 Inch', color: '1B/30 Ombre Honey', length: '30 Inch', capSize: 'Medium (22.5")', stock: 8, sku: 'ABB-EIB-30-30-M' },
        { label: '1B Natural Black / 36 Inch', color: '1B Natural Black', length: '36 Inch', capSize: 'Medium (22.5")', stock: 5, sku: 'ABB-EIB-1B-36-M' },
        { label: '#27 Golden Glow / 26 Inch', color: '#27 Golden Glow', length: '26 Inch', capSize: 'Small (21.5")', stock: 6, sku: 'ABB-EIB-27-26-S' },
      ]
    },
    {
      name: 'Luxe Goddess Pre-Looped Boho Crochet Packs',
      slug: 'luxe-goddess-pre-looped-boho-crochet-packs',
      category: catMap['ready-to-install-boho-crochet-extensions'],
      description: 'Quick, gorgeous, salon-quality crochet braids. Pre-looped and pre-separated with bouncy bohemian ringlets interspersed throughout. Complete your full install in under 90 minutes.',
      details: [
        '6 Packs included in standard bundle (Full Head)',
        'Pre-stretched & pre-looped for effortless latch-hook installation',
        'Silky texture with feather-light density',
        'Long-lasting curl pattern that holds through moisture'
      ],
      hairCareTips: [
        'Separate curls with fingers coated in argan or jojoba oil',
        'Wear a high pineapple with a satin scarf overnight'
      ],
      price: 68.00,
      discountPrice: 59.99,
      isFeatured: true,
      isNewArrival: false,
      rating: 4.8,
      reviewsCount: 64,
      images: [
        { url: '/uploads/IMG_6917_2.PNG', alt: 'Luxe Goddess Boho Crochet Packs', isMain: true },
        { url: '/uploads/IMG_6241.PNG', alt: 'Full install goddess crochet' },
      ],
      videos: [
        { url: '/uploads/b0764e66-7500-4cbd-b533-914f75dc8623.MP4', posterUrl: '/uploads/IMG_6917_2.PNG', type: 'video/mp4' }
      ],
      variants: [
        { label: '1B Natural Black / 24 Inch (6 Packs)', color: '1B Natural Black', length: '24 Inch', capSize: 'N/A', stock: 35, sku: 'ABB-LGC-1B-24' },
        { label: '1B/30 Caramel Swirl / 24 Inch (6 Packs)', color: '1B/30 Caramel Swirl', length: '24 Inch', capSize: 'N/A', stock: 20, sku: 'ABB-LGC-30-24' },
        { label: '99J Burgundy Wine / 28 Inch (6 Packs)', color: '99J Burgundy Wine', length: '28 Inch', capSize: 'N/A', stock: 15, sku: 'ABB-LGC-99J-28' },
      ]
    },
    {
      name: 'Signature Sleek Boho Drawstring Ponytail',
      slug: 'signature-sleek-boho-drawstring-ponytail',
      category: catMap['premium-boho-ponytail-extensions'],
      description: 'The ultimate high-glam power move. Features micro-braided accents transitioning seamlessly into lush bohemian beach waves. Built-in combs and reinforced drawstring guarantee 24-hour security.',
      details: [
        'Secure dual-comb base + heavy-duty adjustable drawstring',
        'Zero salon appointment required — install in 45 seconds',
        'Silky, natural lustre matching Type 3/4 pressed hair',
        'Lightweight, tangle-free synthetic and human curl blend'
      ],
      hairCareTips: [
        'Gently finger-comb the wavy ends starting from the tips',
        'Store on a wig stand or in the signature Ace satin pouch'
      ],
      price: 75.00,
      discountPrice: 65.00,
      isFeatured: true,
      isNewArrival: true,
      rating: 5.0,
      reviewsCount: 29,
      images: [
        { url: '/uploads/IMG_6242.PNG', alt: 'Signature Sleek Boho Ponytail', isMain: true },
        { url: '/uploads/IMG_6920.PNG', alt: 'Ponytail side profile' },
      ],
      videos: [
        { url: '/uploads/c195b193-6dbf-46d9-a79c-82f19d3c9929.MP4', posterUrl: '/uploads/IMG_6242.PNG', type: 'video/mp4' }
      ],
      variants: [
        { label: '1B Natural Black / 26 Inch', color: '1B Natural Black', length: '26 Inch', capSize: 'Universal', stock: 24, sku: 'ABB-SBP-1B-26' },
        { label: '#4 Chocolate Brown / 26 Inch', color: '#4 Chocolate Brown', length: '26 Inch', capSize: 'Universal', stock: 14, sku: 'ABB-SBP-04-26' },
        { label: '#27 Honey Blonde / 30 Inch', color: '#27 Honey Blonde', length: '30 Inch', capSize: 'Universal', stock: 10, sku: 'ABB-SBP-27-30' },
      ]
    },
    {
      name: 'Royal Comfort Full-Cap Cornrow & Curls Wig',
      slug: 'royal-comfort-full-cap-cornrow-curls-wig',
      category: catMap['exquisite-cap-braided-wigs'],
      description: 'Crafted on a stretch-mesh dome cap with precision-stitched cornrows and flowing curls at the crown and perimeter. No glue, no gel, no edge damage. Ideal for active lifestyles and daily glam.',
      details: [
        'Breathable open-weft stretch cap with silicone grip band',
        'Glueless install with zero tension on delicate edges',
        'Precision neat stitch cornrows that will never unravel',
        'Ready to wear right out of the luxury presentation box'
      ],
      hairCareTips: [
        'Air dry completely after freshening curls',
        'Never spray heavy alcohol-based lacquers directly onto the base'
      ],
      price: 185.00,
      discountPrice: 165.00,
      isFeatured: true,
      isNewArrival: false,
      rating: 4.9,
      reviewsCount: 22,
      images: [
        { url: '/uploads/IMG_4065.PNG', alt: 'Royal Comfort Cap Braided Wig', isMain: true },
        { url: '/uploads/IMG_6917_2.PNG', alt: 'Cap detail and interior' },
      ],
      videos: [
        { url: '/uploads/e7ca4ed1-3213-4d09-94ac-c068c8e06451.MP4', posterUrl: '/uploads/IMG_4065.PNG', type: 'video/mp4' }
      ],
      variants: [
        { label: '1B Natural Black / 28 Inch', color: '1B Natural Black', length: '28 Inch', capSize: 'Medium (22.5")', stock: 16, sku: 'ABB-RCC-1B-28-M' },
        { label: '1B/30 Ombre Caramel / 28 Inch', color: '1B/30 Ombre Caramel', length: '28 Inch', capSize: 'Medium (22.5")', stock: 9, sku: 'ABB-RCC-30-28-M' },
        { label: '1B Natural Black / 28 Inch (Large Cap)', color: '1B Natural Black', length: '28 Inch', capSize: 'Large (23.5")', stock: 7, sku: 'ABB-RCC-1B-28-L' },
      ]
    },
    {
      name: 'Monaco Micro Twist HD Lace Front Wig',
      slug: 'monaco-micro-twist-hd-lace-front-wig',
      category: catMap['premium-braided-wigs'],
      description: 'Feather-thin micro Senegalese twists falling effortlessly down the waist. Masterfully hand-tied on a 13x6 HD Swiss Lace frontal for multi-part styling versatility.',
      details: [
        '13x6 Extra-deep parting space for middle and side styling',
        'Over 350+ individual micro twists for extreme realism',
        'Feather-weight design ensuring breathable daily wear'
      ],
      hairCareTips: [
        'Dip twist ends in hot water if needed to restore neat tapered finish'
      ],
      price: 260.00,
      discountPrice: 235.00,
      isFeatured: false,
      isNewArrival: true,
      rating: 4.9,
      reviewsCount: 17,
      images: [
        { url: '/uploads/IMG_6920.PNG', alt: 'Monaco Micro Twist HD Frontal Wig', isMain: true },
        { url: '/uploads/IMG_6241.PNG', alt: 'Twist texture detail' }
      ],
      variants: [
        { label: '1B Natural Black / 32 Inch', color: '1B Natural Black', length: '32 Inch', capSize: 'Medium (22.5")', stock: 8, sku: 'ABB-MMT-1B-32-M' },
        { label: '#33 Rich Auburn / 32 Inch', color: '#33 Rich Auburn', length: '32 Inch', capSize: 'Medium (22.5")', stock: 4, sku: 'ABB-MMT-33-32-M' }
      ]
    },
    {
      name: 'Sahara Goddess Boho French Curl Braids',
      slug: 'sahara-goddess-boho-french-curl-braids',
      category: catMap['ready-to-install-boho-crochet-extensions'],
      description: 'Super silky French curl crochet braids with loose romantic waves. Specially textured to eliminate frizz while giving you maximum volume and movement.',
      details: [
        'Pre-stretched silky fiber with bouncing spiral ends',
        '7-Pack value bundle included',
        'Glossy, healthy sheen'
      ],
      hairCareTips: [
        'Comb through loosely with a wide-tooth comb and leave-in conditioner'
      ],
      price: 72.00,
      discountPrice: 62.00,
      isFeatured: false,
      isNewArrival: true,
      rating: 4.7,
      reviewsCount: 31,
      images: [
        { url: '/uploads/IMG_6917_2.PNG', alt: 'Sahara French Curls Boho Braids', isMain: true },
        { url: '/uploads/IMG_6242.PNG', alt: 'French curls texture' }
      ],
      variants: [
        { label: '1B Natural Black / 26 Inch (7 Packs)', color: '1B Natural Black', length: '26 Inch', capSize: 'N/A', stock: 22, sku: 'ABB-SGB-1B-26' },
        { label: '#27 Champagne Blonde / 26 Inch (7 Packs)', color: '#27 Champagne Blonde', length: '26 Inch', capSize: 'N/A', stock: 11, sku: 'ABB-SGB-27-26' }
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
      videoUrl: '/uploads/2b96717a-1b2c-4f17-9375-e1234043a67a.MP4',
      posterUrl: '/uploads/IMG_4065.PNG',
      linkedProduct: createdProducts[0]._id,
      order: 1,
      isActive: true,
    },
    {
      title: 'Boho Crochet Glam in Berlin',
      customerName: 'Chiamaka E. (Berlin, DE)',
      videoUrl: '/uploads/b0764e66-7500-4cbd-b533-914f75dc8623.MP4',
      posterUrl: '/uploads/IMG_6241.PNG',
      linkedProduct: createdProducts[1]._id,
      order: 2,
      isActive: true,
    },
    {
      title: '60-Sec Sleek Ponytail Magic',
      customerName: 'Sophie M. (Manchester, UK)',
      videoUrl: '/uploads/c195b193-6dbf-46d9-a79c-82f19d3c9929.MP4',
      posterUrl: '/uploads/IMG_6242.PNG',
      linkedProduct: createdProducts[2]._id,
      order: 3,
      isActive: true,
    },
    {
      title: 'Royal Cap Everyday Glow',
      customerName: 'Keisha D. (Birmingham, UK)',
      videoUrl: '/uploads/e7ca4ed1-3213-4d09-94ac-c068c8e06451.MP4',
      posterUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1000&q=80',
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
