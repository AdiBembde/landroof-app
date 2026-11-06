'use strict';
// Sample data for a brand-new database, plus one-off data fixes for existing ones.
// Seeding only runs when a table is empty, so it never overwrites real content.
const db = require('./database');
const Property = require('../models/Property');
const SiteConfig = require('../models/SiteConfig');

function seedProperties() {
  if (db.prepare('SELECT COUNT(*) AS n FROM properties').get().n > 0) return;
  const rows = [
    ['Spacious 3 BHK Apartment','buy','Apartment','₹1.85 Cr',18500000,'EMI from ₹1.24 Lac/mo','1,480 sq ft',3,2,'Ready to Move','Pune','Koregaon Park','Elegant 3 BHK in the heart of Koregaon Park with modular kitchen, marble flooring, 2 covered parking and clubhouse access.'],
    ['Furnished 4 BHK Villa','rent','Villa / Bungalow','₹45,000/mo',45000,'2 months deposit','2,800 sq ft',4,4,'Semi-Furnished','Pune','Baner','Standalone furnished villa with private garden, modern kitchen and quiet residential lane. Pets allowed.'],
    ['Prime Office Space','commercial','Office Space','₹95 Lac',9500000,'EMI from ₹64K/mo','1,200 sq ft',0,2,'Ready','Pune','Viman Nagar','Grade-A commercial space in Viman Nagar IT corridor. Fully fitted, ready for fit-out.'],
    ['2 BHK Starter Apartment','buy','Apartment','₹68 Lac',6800000,'EMI from ₹46K/mo','850 sq ft',2,2,'Under Construction','Pune','Hinjawadi','New launch project with RERA registration. 2 BHK smart homes with IoT features. Possession Dec 2026.'],
    ['Luxury 3 BHK Sea View','buy','Apartment','₹3.2 Cr',32000000,'EMI from ₹2.14 Lac/mo','1,950 sq ft',3,3,'Ready to Move','Mumbai','Worli','High-rise luxury apartment with panoramic sea view, imported finishes and 24x7 concierge.'],
    ['2 BHK Flat for Rent','rent','Apartment','₹28,000/mo',28000,'1 month deposit','1,050 sq ft',2,2,'Semi-Furnished','Bangalore','Whitefield','Well-maintained 2 BHK near Whitefield IT park. Semi-furnished with AC and modular kitchen.'],
  ];
  const keys = ['title','type','subtype','price_label','price_val','emi_label','area','beds','baths','status','city','locality','description'];
  rows.forEach(r => Property.create({ ...Object.fromEntries(keys.map((k, i) => [k, r[i]])), is_featured: 1 }, SAMPLE_PHOTOS[r[0]]));
}

// Photos for the sample listings, shipped in public/images/properties (Unsplash licence)
const SAMPLE_PHOTOS = {
  'Spacious 3 BHK Apartment': '/images/properties/apartment-pune.jpg',
  'Furnished 4 BHK Villa': '/images/properties/villa-baner.jpg',
  'Prime Office Space': '/images/properties/office-tower.jpg',
  '2 BHK Starter Apartment': '/images/properties/apartment-hinjawadi.jpg',
  'Luxury 3 BHK Sea View': '/images/properties/luxury-worli.jpg',
  '2 BHK Flat for Rent': '/images/properties/flat-whitefield.jpg',
};

// ── Landroof's own plotted projects (details and photos from the project brochures) ──
const P = '/images/projects/';
const NEAR_KASARSAI = 'Nearby: Hiranandani Township 5 min · Nandan Green Meadows 5–7 min · Life Republic 7–10 min · Upcoming Godrej Properties township 5–10 min · Hinjawadi IT Park 10–15 min · Mumbai–Pune Expressway 20–25 min.';
const PROJECTS = [
  {
    title: 'Codename Nature Vailly', subtype: 'Residential Plot', status: 'Pre-Launch',
    price_label: '₹12 Lakh / guntha', price_val: 12000000, emi_label: 'Pre-launch offer · minimum 10 guntha',
    area: '10 Guntha+', area_sqft: 10890, locality: 'Kasarsai, near Hinjawadi',
    image: P + 'nature-vailly-cover.jpg',
    gallery: ['nature-vailly-1.jpg', 'nature-vailly-2.jpg', 'nature-vailly-3.jpg', 'nature-vailly-4.jpg', 'nature-vailly-5.jpg'],
    description: `A premium plotted community in the Kasarsai area of Pune, near Hinjawadi — lakefront living with mountains all around. Where nature meets opportunity.

Investment plan (per guntha, minimum 10 guntha)
• Pre-launch offer: ₹12 Lakh
• Launch price (in 5 months): ₹16 Lakh — about 33% growth
• Project completion (in 16 months): ₹21 Lakh — about 75% total growth

Amenities: club house, landscaped garden, lake-view sit-out, indoor games, walking track, gazebo & recreation area, 30 ft internal roads, wall compound, gated community with security.

Why Kasarsai: scenic lake with a mountain backdrop, a weekend hotspot for cycling, boating and cafés, fast-growing residential and villa projects, and close to Hinjawadi for strong rental and resale potential.

${NEAR_KASARSAI}

A limited opportunity — only 2 investors required.`,
  },
  {
    title: 'Water Front – Resort Living', subtype: 'Residential Plot', status: 'Pre-Launch',
    price_label: '₹21 Lakh / guntha', price_val: 2100000, emi_label: 'Pre-launch · ₹25 Lakh / guntha after launch',
    area: null, area_sqft: null, locality: 'Kasarsai, near Hinjawadi',
    image: P + 'water-front-cover.jpg',
    gallery: ['water-front-1.jpg'],
    description: `A premium lakeside plotted community in the heart of Kasarsai — the lake in front, mountains behind. A life closer to nature, with modern amenities and excellent connectivity.

Investment plan (per guntha)
• Pre-launch price: ₹21 Lakh
• Post-launch price: ₹25 Lakh

Amenities: club house & recreation, swimming pool, landscaped garden, walking track, indoor games, children's play area, gated community with 24x7 security.

Why in front of the lake: unobstructed scenic views, premium and limited availability, high lifestyle value, more appreciation potential, ideal for weekend homes and future living.

${NEAR_KASARSAI}`,
  },
  {
    title: 'Royal Estate', subtype: 'Residential Plot', status: 'Gated Community',
    price_label: 'Price on request', price_val: 0, emi_label: 'Total project area 3.5 acre',
    area: '3.5 Acre project', area_sqft: null, locality: 'Near Hiranandani Township',
    image: P + 'royal-estate-cover.jpg',
    gallery: ['royal-estate-1.jpg', 'royal-estate-2.jpg', 'royal-estate-3.jpg'],
    description: `A premium plotted development by Landroof — a royal address near Hiranandani Township, Pune, spread over 3.5 acres.

Amenities: wide internal roads, street lighting, compound wall, main gate with 24x7 security, wooden club house, landscaped green spaces, tree plantation.

Location: near Hiranandani Township in a developed neighbourhood, with excellent connectivity and peaceful green surroundings. Existing houses and a sugar factory are nearby.`,
  },
  {
    title: 'Mount View – Luxury Plots', subtype: 'Residential Plot', status: 'Only 11 Plots',
    price_label: '₹2,500 – ₹3,000 / sq ft', price_val: 0, emi_label: 'Only 11 executive plots',
    area: null, area_sqft: null, locality: 'Near Hiranandani Township',
    image: P + 'mount-view-cover.jpg',
    gallery: ['mount-view-1.jpg', 'mount-view-2.jpg'],
    description: `A luxury plotted community near Hiranandani Township, Pune — in the heart of the city, surrounded by nature, with lake views and a mountain backdrop. Only 11 executive plots (A, B and C types) on a 30 ft (9 m) internal road, with frontage on the existing 15 m road.

Amenities: 30 ft internal road, street lighting, gated community, wall compound, 24x7 security, landscaped green spaces, wooden club house, tree plantation, amenity area & garden.

Nearby landmarks: 86 Banyan Tree, Hinjawadi Annexe (~4 km) · Pune Ring Road, upcoming (~5 km) · Hiranandani Krisala Township, North Hinjawadi (~6 km) · Green Meadows, Pachane (~7 km) · Life Republic, Marunji (~8 km). A sugar factory is nearby (as per the 7/12 document).`,
  },
];

/** Adds the projects once (an admin may edit or delete them afterwards) and retires the template demo plots */
function seedProjects() {
  const done = db.prepare("SELECT 1 FROM site_config WHERE key='seed_projects_v1'").get();
  if (done) return;
  db.transaction(() => {
    db.prepare("DELETE FROM properties WHERE title='Residential NA Plot' AND locality='Wagholi'").run();
    db.prepare("DELETE FROM properties WHERE title='Agricultural Land' AND locality='Khed'").run();
    const exists = db.prepare('SELECT 1 FROM properties WHERE title=?');
    const extra = db.prepare('UPDATE properties SET gallery=?, area_sqft=? WHERE id=?');
    // Insert in reverse so the first project is the newest (listings show newest first)
    [...PROJECTS].reverse().forEach(({ image, gallery, area_sqft, ...p }) => {
      if (exists.get(p.title)) return;
      const created = Property.create({ ...p, type: 'plots', city: 'Pune', beds: 0, baths: 0, is_featured: 1 }, image);
      extra.run(JSON.stringify(gallery.map(f => P + f)), area_sqft, created.id);
    });
    db.prepare("INSERT INTO site_config (key,value) VALUES ('seed_projects_v1','1')").run();
  })();
}

function seedTestimonials() {
  if (db.prepare('SELECT COUNT(*) AS n FROM testimonials').get().n > 0) return;
  const ins = db.prepare('INSERT INTO testimonials (name,role,city,rating,text) VALUES (?,?,?,?,?)');
  [
    ['Rahul Mehta','Software Engineer','Pune',5,'Landroof made finding our first home so easy. The search filters are excellent and the team was very responsive. Highly recommend!'],
    ['Priya Sharma','Business Owner','Mumbai',5,'Sold my commercial property through Landroof in just 3 weeks. The admin team handled everything professionally. Great platform!'],
    ['Amit Kulkarni','IT Professional','Bangalore',5,'Found a perfect 3 BHK in Whitefield. The property details were accurate and the enquiry process was smooth. Will use again!'],
  ].forEach(r => ins.run(...r));
}

// The cities shown before an admin edits them, with photos shipped in public/images/cities
function seedCities() {
  if (db.prepare('SELECT COUNT(*) AS n FROM cities').get().n > 0) return;
  const ins = db.prepare('INSERT INTO cities (name,state,image,order_idx) VALUES (?,?,?,?)');
  [
    ['Pune','Maharashtra','/images/cities/pune.jpg'],
    ['Mumbai','Maharashtra','/images/cities/mumbai.jpg'],
    ['Bangalore','Karnataka','/images/cities/bangalore.jpg'],
    ['Hyderabad','Telangana','/images/cities/hyderabad.jpg'],
    ['Delhi NCR','Delhi','/images/cities/delhi.jpg'],
    ['Chennai','Tamil Nadu','/images/cities/chennai.jpg'],
  ].forEach((r, i) => ins.run(...r, i + 1));
}

function seedTeam() {
  if (db.prepare('SELECT COUNT(*) AS n FROM team_members').get().n > 0) return;
  const ins = db.prepare('INSERT INTO team_members (name,role,bio,order_idx) VALUES (?,?,?,?)');
  [
    ['Rajesh Patel','Founder & CEO','20+ years in real estate, former HDFC Property head. Visionary behind Landroof\'s pan-India expansion.',1],
    ['Anjali Singh','Head of Sales','Closed over ₹500 Cr in transactions across Pune and Mumbai. Expert in luxury residential.',2],
    ['Vikram Nair','Chief Technology Officer','Built Landroof\'s AI-powered matching engine. Ex-Infosys, IIT Bombay alumnus.',3],
  ].forEach(r => ins.run(...r));
}

// Upgrades rows created by earlier versions of the app
function fixExistingData() {
  // Fill the numeric area column used by the area search filter
  const upd = db.prepare('UPDATE properties SET area_sqft=? WHERE id=?');
  db.prepare('SELECT id, area FROM properties WHERE area_sqft IS NULL').all()
    .forEach(r => upd.run(Property.parseSqft(r.area), r.id));

  // Give the original sample listings a subtype so the "Property Type" filter matches them exactly
  const subtypes = {
    'Spacious 3 BHK Apartment':'Apartment', 'Furnished 4 BHK Villa':'Villa / Bungalow',
    'Prime Office Space':'Office Space',
    '2 BHK Starter Apartment':'Apartment', 'Luxury 3 BHK Sea View':'Apartment',
    '2 BHK Flat for Rent':'Apartment',
  };
  const setSub = db.prepare("UPDATE properties SET subtype=? WHERE title=? AND COALESCE(subtype,'')=''");
  Object.entries(subtypes).forEach(([title, sub]) => setSub.run(sub, title));

  // The real WhatsApp number replaces the old placeholder (a number set by an admin is kept)
  db.prepare("UPDATE site_config SET value='917083853002' WHERE key='whatsapp_number' AND value='919999999999'").run();

  // Office phone number, if none has been set yet
  db.prepare("UPDATE site_config SET value='+91 70838 53002' WHERE key='contact_phone' AND COALESCE(value,'')=''").run();

  // Sample listings created before they had photos (never replaces a photo an admin uploaded)
  const setPhoto = db.prepare("UPDATE properties SET image=? WHERE title=? AND COALESCE(image,'')=''");
  Object.entries(SAMPLE_PHOTOS).forEach(([title, photo]) => setPhoto.run(photo, title));

  seedListingDetails();
}

// Locality centres (approximate) for the sample listings and projects, so the map search has pins
const LOCALITY_PINS = {
  'Koregaon Park': [18.5362, 73.8940], 'Baner': [18.5590, 73.7868], 'Viman Nagar': [18.5679, 73.9143],
  'Hinjawadi': [18.5913, 73.7389], 'Worli': [19.0176, 72.8162], 'Whitefield': [12.9698, 77.7500],
  'Kasarsai, near Hinjawadi': [18.6060, 73.6680], 'Near Hiranandani Township': [18.6010, 73.6905],
};
const SAMPLE_DETAILS = {
  'Spacious 3 BHK Apartment': { possession: 'Ready to Move', age_band: '1-5 years', amenities: 'Lift, Parking, Power Backup, Security, Club House, Modular Kitchen' },
  'Furnished 4 BHK Villa': { furnishing: 'Semi-Furnished', possession: 'Ready to Move', age_band: '5-10 years', amenities: 'Parking, Garden, Security, Pet Friendly, Modular Kitchen' },
  'Prime Office Space': { furnishing: 'Furnished', possession: 'Ready to Move', age_band: '1-5 years', amenities: 'Lift, Parking, Power Backup, Security, Air Conditioning' },
  '2 BHK Starter Apartment': { possession: 'Under Construction', age_band: 'New / Under construction', amenities: 'Lift, Parking, Power Backup, Security, Gym, Swimming Pool, Club House' },
  'Luxury 3 BHK Sea View': { possession: 'Ready to Move', age_band: '1-5 years', amenities: 'Lift, Parking, Power Backup, Security, Gym, Swimming Pool, Club House, Balcony' },
  '2 BHK Flat for Rent': { furnishing: 'Semi-Furnished', possession: 'Ready to Move', age_band: '5-10 years', amenities: 'Lift, Parking, Power Backup, Security, Air Conditioning, Modular Kitchen' },
  'Codename Nature Vailly': { is_project: 1, possession: 'Under Construction', amenities: "Club House, Garden, Internal Roads, Compound Wall, Gated Community, Security" },
  'Water Front – Resort Living': { is_project: 1, possession: 'Under Construction', amenities: "Club House, Swimming Pool, Garden, Children's Play Area, Gated Community, Security" },
  'Royal Estate': { is_project: 1, possession: 'Ready to Move', amenities: 'Internal Roads, Street Lights, Compound Wall, Security, Club House, Garden, Gated Community' },
  'Mount View – Luxury Plots': { is_project: 1, possession: 'Ready to Move', amenities: 'Internal Roads, Street Lights, Gated Community, Compound Wall, Security, Garden, Club House' },
};

/** Once: furnishing / possession / amenities and map pins for the sample listings and projects */
function seedListingDetails() {
  if (db.prepare("SELECT 1 FROM site_config WHERE key='seed_details_v1'").get()) return;
  db.transaction(() => {
    Object.entries(SAMPLE_DETAILS).forEach(([title, d]) => {
      const cols = Object.keys(d);
      db.prepare(`UPDATE properties SET ${cols.map(c => `${c}=?`).join(',')} WHERE title=? AND owner_id IS NULL`).run(...cols.map(c => d[c]), title);
    });
    const pin = db.prepare('UPDATE properties SET lat=?, lng=? WHERE locality=? AND lat IS NULL AND owner_id IS NULL');
    Object.entries(LOCALITY_PINS).forEach(([loc, [lat, lng]]) => pin.run(lat, lng, loc));
    db.prepare("INSERT INTO site_config (key,value) VALUES ('seed_details_v1','1')").run();
  })();
}

function seed() {
  seedProperties();
  seedProjects();
  seedTestimonials();
  seedTeam();
  seedCities();
  SiteConfig.seedDefaults();
  fixExistingData();
}

module.exports = seed;
