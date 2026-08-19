import { Activity } from '@/context/trips';

export interface PlaceReview {
  source: string;
  text: string;
  rating: number;
  date: string;
  theme?: 'food' | 'service' | 'atmosphere' | 'value' | 'view';
}

export interface PlaceOption {
  title: string;
  type: Activity['type'];
  category: string;
  cost: 'free' | 'budget' | 'moderate' | 'premium';
  duration: number;
  description: string;
  tags: string[];
  crowdLevel: 'low' | 'medium' | 'high';
  energyLevel: 'low' | 'medium' | 'high';
  bestTime?: string;
  // Rich metadata
  rating?: number;
  reviewCount?: number;
  atmosphere?: string[];
  address?: string;
  neighborhood?: string;
  hours?: string;
  weeklyHours?: Record<string, string>;
  dietaryOptions?: string[];
  phone?: string;
  website?: string;
  accessibility?: string[];
  // Restaurant-specific
  cuisine?: string;
  pricePerPerson?: string;
  popularDishes?: string[];
  menuCategories?: string[];
  reservationsRecommended?: boolean;
  takeout?: boolean;
  delivery?: boolean;
  outdoorSeating?: boolean;
  rooftop?: boolean;
  waterfront?: boolean;
  scenicView?: boolean;
  noiseLevel?: 'quiet' | 'moderate' | 'lively';
  dressCode?: string;
  familyFriendly?: boolean;
  groupFriendly?: boolean;
  petFriendly?: boolean;
  wifi?: boolean;
  parking?: boolean;
  // Reviews
  reviews?: PlaceReview[];
  reviewSummary?: string;
  bestQualities?: string[];
  commonComplaints?: string[];
  // Photos
  photoCount?: number;
  photoCategories?: string[];
  // Coordinates for map
  lat?: number;
  lng?: number;
  // Status
  openNow?: boolean;
  closingTime?: string;
  busyLevel?: 'not busy' | 'moderate' | 'busy' | 'very busy';
  estimatedWait?: string;
  walkingTime?: string;
  // Personalization
  matchScore?: number;
  matchReasons?: string[];
  warnings?: string[];
  // Meta
  lastUpdated?: string;
  verified?: boolean;
}

// Per-destination alternatives pools
const ALTERNATIVES: Record<string, PlaceOption[]> = {
  Tokyo: [
    { title: 'TeamLab Borderless', type: 'activity', category: 'art', cost: 'moderate', duration: 120, description: 'Immersive digital art museum with interactive light installations that react to your presence. A mesmerizing experience blending technology and art.', tags: ['Art & Museums', 'Photography'], crowdLevel: 'medium', energyLevel: 'low', rating: 4.7, reviewCount: 2840, atmosphere: ['Immersive', 'Romantic', 'Family-friendly'], address: 'Azabudai Hills, Minato City', neighborhood: 'Roppongi', hours: '10:00 - 21:00', accessibility: ['Wheelchair accessible', 'Elevator access'], lat: 35.6595, lng: 139.7294, openNow: true, closingTime: '21:00', familyFriendly: true, walkingTime: '12 min', photoCount: 24, photoCategories: ['Interior', 'Art', 'Exterior'], verified: true, lastUpdated: '2026-08-01', reviewSummary: 'A must-visit for art lovers. Stunning visuals and immersive rooms that blend technology and nature.', bestQualities: ['Immersive experience', 'Unique photo opportunities', 'Interactive exhibits'], commonComplaints: ['Can be crowded on weekends', 'Expensive tickets'] },
    { title: 'Senso-ji Temple', type: 'activity', category: 'culture', cost: 'free', duration: 90, description: 'Historic Buddhist temple in Asakusa with the iconic Kaminarimon gate. Walk the Nakamise-dori shopping street leading to the main hall.', tags: ['History', 'Culture', 'Photography'], crowdLevel: 'high', energyLevel: 'medium', rating: 4.5, reviewCount: 5120, atmosphere: ['Historic', 'Spiritual', 'Lively'], address: '2-3-1 Asakusa, Taito City', neighborhood: 'Asakusa', hours: '6:00 - 17:00', accessibility: ['Partially wheelchair accessible'], lat: 35.7148, lng: 139.7967, openNow: true, closingTime: '17:00', familyFriendly: true, walkingTime: '25 min', photoCount: 18, verified: true, warnings: ['Very crowded midday, visit early morning for a quieter experience'] },
    { title: 'Yanaka Old Town walk', type: 'activity', category: 'culture', cost: 'free', duration: 120, description: 'Quiet traditional neighborhood stroll through one of Tokyo\'s few areas that survived WWII. Cat-themed shops, old temples, and local artisans.', tags: ['Culture', 'Photography'], crowdLevel: 'low', energyLevel: 'medium', rating: 4.4, reviewCount: 620, atmosphere: ['Quiet', 'Authentic', 'Charming'], neighborhood: 'Yanaka', lat: 35.7267, lng: 139.7672, walkingTime: '30 min', photoCount: 8 },
    { title: 'Shinjuku Gyoen Garden', type: 'activity', category: 'nature', cost: 'budget', duration: 90, description: 'Beautiful national garden spanning Japanese, English, and French landscape styles. Cherry blossoms in spring, autumn foliage in fall.', tags: ['Nature', 'Photography'], crowdLevel: 'medium', energyLevel: 'low', rating: 4.6, reviewCount: 3200, atmosphere: ['Peaceful', 'Scenic', 'Romantic'], address: '11 Naitomachi, Shinjuku City', neighborhood: 'Shinjuku', hours: '9:00 - 16:30', accessibility: ['Wheelchair accessible', 'Paved paths'], lat: 35.6852, lng: 139.7100, openNow: true, closingTime: '16:30', familyFriendly: true, walkingTime: '15 min', scenicView: true, photoCount: 16, verified: true },
    { title: 'Robot Restaurant', type: 'activity', category: 'nightlife', cost: 'premium', duration: 90, description: 'Wild neon robot show with dancers, lasers, and giant mechanical creatures. A sensory overload experience unique to Tokyo.', tags: ['Nightlife', 'Adventure'], crowdLevel: 'medium', energyLevel: 'medium', rating: 3.8, reviewCount: 1890, atmosphere: ['Energetic', 'Loud', 'Unique'], neighborhood: 'Shinjuku', lat: 35.6938, lng: 139.7034, noiseLevel: 'lively', reservationsRecommended: true, photoCount: 12, warnings: ['Very loud, not suitable for young children or noise-sensitive visitors'] },
    { title: 'Tsukemen at Fuunji', type: 'food', category: 'food', cost: 'budget', duration: 45, description: 'Famous dipping ramen spot near Shinjuku station. Rich fish and pork broth with thick noodles. Expect a short queue but fast turnover.', tags: ['Food & Dining'], crowdLevel: 'high', energyLevel: 'low', rating: 4.5, reviewCount: 1450, atmosphere: ['Casual', 'Authentic'], address: 'Yoyogi, Shibuya City', neighborhood: 'Shinjuku', hours: '11:00 - 15:00, 17:00 - 21:00', dietaryOptions: ['Contains pork', 'Contains fish'], cuisine: 'Ramen', pricePerPerson: '\u00A5900-1200', popularDishes: ['Tsukemen (dipping ramen)', 'Ajitama tsukemen'], lat: 35.6893, lng: 139.7013, openNow: true, closingTime: '21:00', takeout: false, noiseLevel: 'moderate', walkingTime: '8 min', photoCount: 6, reviews: [{ source: 'Google', text: 'Best tsukemen in Tokyo. The broth is incredibly rich and the noodles are perfectly chewy.', rating: 5, date: '2026-07', theme: 'food' }, { source: 'TripAdvisor', text: 'Short wait, fast service. Counter seating only but the food is worth it.', rating: 4, date: '2026-06', theme: 'service' }], reviewSummary: 'Consistently praised for its rich, complex broth and perfectly textured noodles.', bestQualities: ['Outstanding broth', 'Fast turnover despite queues', 'Generous portions'], commonComplaints: ['Counter seating only', 'No vegetarian options', 'Cash only'], verified: true },
    { title: 'Soba noodles at Kamachiku', type: 'food', category: 'food', cost: 'moderate', duration: 60, description: 'Traditional soba in a converted warehouse with garden seating. Handmade buckwheat noodles served hot or cold.', tags: ['Food & Dining', 'Culture'], crowdLevel: 'low', energyLevel: 'low', rating: 4.3, reviewCount: 380, atmosphere: ['Quiet', 'Traditional', 'Garden'], neighborhood: 'Ueno', dietaryOptions: ['Vegetarian options', 'Contains gluten'], cuisine: 'Soba', pricePerPerson: '\u00A51500-2500', popularDishes: ['Zaru soba', 'Tempura soba set'], outdoorSeating: true, lat: 35.7180, lng: 139.7710, noiseLevel: 'quiet', walkingTime: '20 min', photoCount: 8, reviews: [{ source: 'Google', text: 'Beautiful garden setting. The soba is freshly made and you can taste the difference.', rating: 5, date: '2026-05', theme: 'atmosphere' }], verified: true },
    { title: 'Depachika food hall tour', type: 'food', category: 'food', cost: 'moderate', duration: 90, description: 'Department store basement food halls are a Tokyo institution. Sample wagyu, fresh sushi, artisan pastries, and beautifully packaged bento boxes.', tags: ['Food & Dining', 'Shopping'], crowdLevel: 'medium', energyLevel: 'low', rating: 4.4, reviewCount: 920, neighborhood: 'Ginza', cuisine: 'Various', lat: 35.6717, lng: 139.7650, walkingTime: '18 min', familyFriendly: true, photoCount: 10 },
    { title: 'Shimokitazawa vintage shopping', type: 'activity', category: 'shopping', cost: 'budget', duration: 150, description: 'Indie shops and cafes in Tokyo\'s bohemian neighborhood. Vintage clothing, vinyl records, independent bookshops, and cozy coffee.', tags: ['Shopping', 'Culture'], crowdLevel: 'low', energyLevel: 'medium', rating: 4.3, reviewCount: 710, atmosphere: ['Trendy', 'Relaxed', 'Indie'], neighborhood: 'Shimokitazawa', lat: 35.6614, lng: 139.6682, walkingTime: '35 min', photoCount: 12 },
    { title: 'Odaiba waterfront', type: 'activity', category: 'nature', cost: 'free', duration: 180, description: 'Man-made island with rainbow bridge views, a small beach, shopping malls, and the iconic Unicorn Gundam statue. Perfect for a relaxed afternoon.', tags: ['Nature', 'Beach'], crowdLevel: 'low', energyLevel: 'low', rating: 4.1, reviewCount: 1560, neighborhood: 'Odaiba', lat: 35.6267, lng: 139.7750, waterfront: true, scenicView: true, familyFriendly: true, walkingTime: '40 min', photoCount: 14 },
    { title: 'Sumo morning practice', type: 'activity', category: 'culture', cost: 'free', duration: 120, description: 'Watch sumo wrestlers train at a local stable. Arrive early and sit quietly on the floor. A rare glimpse into this ancient tradition.', tags: ['Culture', 'Adventure'], crowdLevel: 'low', energyLevel: 'low', bestTime: '07:00', rating: 4.8, reviewCount: 240, atmosphere: ['Authentic', 'Quiet', 'Rare'], neighborhood: 'Ryogoku', lat: 35.6969, lng: 139.7928, walkingTime: '22 min', photoCount: 4, warnings: ['Must arrive before 8am', 'No talking or phone sounds during practice'] },
    { title: 'Izakaya hopping in Yurakucho', type: 'food', category: 'food', cost: 'moderate', duration: 120, description: 'Under-the-tracks bar crawl through tiny yakitori joints and sake bars. Locals outnumber tourists here. Smoky, intimate, unforgettable.', tags: ['Food & Dining', 'Nightlife'], crowdLevel: 'medium', energyLevel: 'medium', bestTime: '18:00', rating: 4.6, reviewCount: 830, atmosphere: ['Lively', 'Authentic', 'Social'], neighborhood: 'Yurakucho', dietaryOptions: ['Meat-focused', 'Alcohol available'], cuisine: 'Izakaya', pricePerPerson: '\u00A53000-5000', popularDishes: ['Yakitori skewers', 'Draft beer', 'Edamame'], lat: 35.6749, lng: 139.7628, openNow: true, closingTime: '23:00', noiseLevel: 'lively', groupFriendly: true, walkingTime: '14 min', photoCount: 8, reviews: [{ source: 'Google', text: 'The most authentic Tokyo experience. Squeeze into a tiny bar, point at the menu, and enjoy.', rating: 5, date: '2026-07', theme: 'atmosphere' }], verified: true },
    { title: 'Park Hyatt Tokyo', type: 'hotel', category: 'hotel', cost: 'premium', duration: 480, description: 'Iconic luxury hotel in Shinjuku skyscrapers, famous from Lost in Translation. Stunning city views from the New York Bar and exceptional service.', tags: ['Luxury', 'City view', 'Iconic'], crowdLevel: 'low', energyLevel: 'low', rating: 4.8, reviewCount: 1240, atmosphere: ['Sophisticated', 'Quiet', 'Romantic'], neighborhood: 'Shinjuku', lat: 35.6845, lng: 139.6917, accessibility: ['Wheelchair accessible', 'Elevator access'], wifi: true, parking: true, familyFriendly: true, photoCount: 20, verified: true },
    { title: 'Aman Tokyo', type: 'hotel', category: 'hotel', cost: 'premium', duration: 480, description: 'Ultra-minimalist sanctuary in the Otemachi Tower with Imperial Palace views. Exceptional spa and serene design inspired by traditional Japanese architecture.', tags: ['Luxury', 'Wellness', 'Views'], crowdLevel: 'low', energyLevel: 'low', rating: 4.9, reviewCount: 580, atmosphere: ['Zen', 'Exclusive', 'Sophisticated'], neighborhood: 'Otemachi', lat: 35.6866, lng: 139.7638, wifi: true, parking: true, accessibility: ['Wheelchair accessible'], photoCount: 16, verified: true },
    { title: 'Remm Akihabara', type: 'hotel', category: 'hotel', cost: 'budget', duration: 480, description: 'Compact, smart hotel in the heart of Akihabara electronics district. Great value with well-designed rooms and excellent transport access.', tags: ['Budget', 'Central', 'Tech district'], crowdLevel: 'medium', energyLevel: 'low', rating: 4.2, reviewCount: 920, neighborhood: 'Akihabara', lat: 35.6987, lng: 139.7715, wifi: true, accessibility: ['Elevator access'], photoCount: 10 },
  ],
  Barcelona: [
    { title: 'Casa Batllo tour', type: 'activity', category: 'architecture', cost: 'moderate', duration: 90, description: 'Gaudi masterpiece on Passeig de Gracia. The immersive audio guide takes you through the building\'s organic architecture and hidden details.', tags: ['Architecture', 'Art & Museums'], crowdLevel: 'high', energyLevel: 'low', rating: 4.6, reviewCount: 4200, atmosphere: ['Artistic', 'Historic', 'Immersive'], neighborhood: 'Eixample', address: 'Pg. de Gracia 43', lat: 41.3917, lng: 2.1649, openNow: true, closingTime: '21:00', hours: '9:00 - 21:00', reservationsRecommended: true, accessibility: ['Elevator access'], walkingTime: '10 min', photoCount: 16, verified: true },
    { title: 'Montjuic Castle & gardens', type: 'activity', category: 'nature', cost: 'budget', duration: 180, description: 'Hilltop castle with panoramic city and sea views. Walk through the botanical gardens, ride the cable car, and explore the fortress walls.', tags: ['Nature', 'History'], crowdLevel: 'low', energyLevel: 'high', rating: 4.4, reviewCount: 2800, atmosphere: ['Scenic', 'Historic', 'Peaceful'], neighborhood: 'Montjuic', lat: 41.3634, lng: 2.1660, scenicView: true, walkingTime: '25 min', photoCount: 14, familyFriendly: true },
    { title: 'El Born neighborhood walk', type: 'activity', category: 'culture', cost: 'free', duration: 120, description: 'Trendy medieval quarter with boutique shops, artisan cocktail bars, and the stunning Santa Maria del Mar basilica.', tags: ['Culture', 'Shopping'], crowdLevel: 'medium', energyLevel: 'medium', rating: 4.5, reviewCount: 1600, atmosphere: ['Trendy', 'Historic', 'Lively'], neighborhood: 'El Born', lat: 41.3849, lng: 2.1825, walkingTime: '12 min', photoCount: 10 },
    { title: 'Picasso Museum', type: 'activity', category: 'art', cost: 'moderate', duration: 90, description: 'Extensive collection of early Picasso works housed in five medieval palaces. Essential for understanding the artist\'s formative years.', tags: ['Art & Museums', 'History'], crowdLevel: 'high', energyLevel: 'low', rating: 4.3, reviewCount: 3500, neighborhood: 'El Born', lat: 41.3852, lng: 2.1811, hours: '10:00 - 20:00', accessibility: ['Wheelchair accessible'], walkingTime: '14 min', photoCount: 8, verified: true, warnings: ['Book tickets in advance, often sold out'] },
    { title: 'Mercat de Santa Caterina', type: 'food', category: 'food', cost: 'budget', duration: 60, description: 'Colorful local market with a stunning wavy roof. Fresh produce, tapas counters, and local specialties without the tourist crush of Boqueria.', tags: ['Food & Dining', 'Local Markets'], crowdLevel: 'low', energyLevel: 'low', rating: 4.3, reviewCount: 890, cuisine: 'Market / Tapas', neighborhood: 'El Born', lat: 41.3868, lng: 2.1793, hours: '7:30 - 15:30', openNow: true, closingTime: '15:30', pricePerPerson: '\u20AC8-15', dietaryOptions: ['Vegetarian options', 'Gluten-free options', 'Seafood'], walkingTime: '13 min', photoCount: 10, verified: true },
    { title: 'Sunset at Bunkers del Carmel', type: 'activity', category: 'nature', cost: 'free', duration: 90, description: 'Best 360-degree panoramic view of Barcelona from Civil War-era bunkers. Bring a bottle of cava and watch the sunset paint the city.', tags: ['Nature', 'Photography'], crowdLevel: 'medium', energyLevel: 'high', bestTime: '18:00', rating: 4.7, reviewCount: 2100, atmosphere: ['Romantic', 'Scenic', 'Relaxed'], neighborhood: 'El Carmel', lat: 41.4185, lng: 2.1574, scenicView: true, walkingTime: '35 min', photoCount: 12, warnings: ['Steep uphill walk, no public transport to the top'] },
    { title: 'Pintxos in Poble Sec', type: 'food', category: 'food', cost: 'budget', duration: 90, description: 'Carrer de Blai is Barcelona\'s pintxos street. Hop between bars, grabbing skewered tapas for \u20AC1-2 each. Best experience after 8pm.', tags: ['Food & Dining'], crowdLevel: 'medium', energyLevel: 'low', bestTime: '20:00', rating: 4.4, reviewCount: 1200, cuisine: 'Pintxos / Tapas', neighborhood: 'Poble Sec', lat: 41.3734, lng: 2.1639, pricePerPerson: '\u20AC10-20', popularDishes: ['Pintxos assortment', 'Patatas bravas', 'Vermouth'], noiseLevel: 'lively', groupFriendly: true, walkingTime: '18 min', photoCount: 8, verified: true },
    { title: 'Gracia neighborhood', type: 'activity', category: 'culture', cost: 'free', duration: 120, description: 'Former village with a bohemian soul. Small plazas, independent shops, vintage stores, and some of the best brunch spots in Barcelona.', tags: ['Culture', 'Shopping'], crowdLevel: 'low', energyLevel: 'medium', rating: 4.4, reviewCount: 920, atmosphere: ['Bohemian', 'Local', 'Relaxed'], neighborhood: 'Gracia', lat: 41.4029, lng: 2.1566, walkingTime: '22 min', photoCount: 8 },
    { title: 'Kayaking on the Mediterranean', type: 'activity', category: 'adventure', cost: 'moderate', duration: 120, description: 'Sea kayaking along the Barcelona coastline with views of the city skyline. Includes a stop for swimming in a hidden cove.', tags: ['Adventure', 'Beach'], crowdLevel: 'low', energyLevel: 'high', rating: 4.7, reviewCount: 450, atmosphere: ['Adventurous', 'Active', 'Scenic'], neighborhood: 'Barceloneta', lat: 41.3784, lng: 2.1893, reservationsRecommended: true, walkingTime: '20 min', photoCount: 6 },
    { title: 'Flamenco at Tablao Cordobes', type: 'activity', category: 'culture', cost: 'moderate', duration: 90, description: 'Intimate flamenco performance by world-class dancers and musicians. Optional dinner pairing with traditional Andalusian cuisine.', tags: ['Culture', 'Music', 'Nightlife'], crowdLevel: 'medium', energyLevel: 'low', bestTime: '21:00', rating: 4.5, reviewCount: 1800, atmosphere: ['Passionate', 'Intimate', 'Cultural'], neighborhood: 'Las Ramblas', lat: 41.3809, lng: 2.1735, hours: '19:00 - 23:00', reservationsRecommended: true, noiseLevel: 'moderate', walkingTime: '15 min', photoCount: 8, verified: true },
    { title: 'Hotel Arts Barcelona', type: 'hotel', category: 'hotel', cost: 'premium', duration: 480, description: 'Iconic beachfront skyscraper hotel with direct Mediterranean access. Two Michelin-star dining, spa, and pool terrace with stunning sea views.', tags: ['Luxury', 'Beach', 'Sea views'], crowdLevel: 'low', energyLevel: 'low', rating: 4.7, reviewCount: 1620, atmosphere: ['Glamorous', 'Relaxed', 'Scenic'], neighborhood: 'Barceloneta', lat: 41.3851, lng: 2.1970, wifi: true, parking: true, accessibility: ['Wheelchair accessible', 'Elevator access'], familyFriendly: true, photoCount: 22, verified: true },
    { title: 'Praktik Rambla', type: 'hotel', category: 'hotel', cost: 'moderate', duration: 480, description: 'Stylish boutique hotel on Las Ramblas with a rooftop pool and terrace. Central location within walking distance of all major sights.', tags: ['Boutique', 'Central', 'Rooftop'], crowdLevel: 'medium', energyLevel: 'low', rating: 4.4, reviewCount: 840, atmosphere: ['Modern', 'Social', 'Trendy'], neighborhood: 'Las Ramblas', lat: 41.3847, lng: 2.1703, wifi: true, accessibility: ['Elevator access'], photoCount: 12, verified: true },
  ],
  Kyoto: [
    { title: 'Philosopher\'s Path walk', type: 'activity', category: 'nature', cost: 'free', duration: 90, description: 'Scenic canal-side walking path', tags: ['Nature', 'Photography'], crowdLevel: 'medium', energyLevel: 'medium' },
    { title: 'Nijo Castle', type: 'activity', category: 'culture', cost: 'moderate', duration: 90, description: 'Shogun castle with nightingale floors', tags: ['History', 'Culture', 'Architecture'], crowdLevel: 'medium', energyLevel: 'medium' },
    { title: 'Gion district evening walk', type: 'activity', category: 'culture', cost: 'free', duration: 90, description: 'Traditional geisha district at dusk', tags: ['Culture', 'Photography'], crowdLevel: 'medium', energyLevel: 'low', bestTime: '17:00' },
    { title: 'Matcha ceremony experience', type: 'activity', category: 'culture', cost: 'moderate', duration: 60, description: 'Traditional tea ceremony', tags: ['Culture', 'Wellness & Spa'], crowdLevel: 'low', energyLevel: 'low' },
    { title: 'Tofu kaiseki at Okutan', type: 'food', category: 'food', cost: 'moderate', duration: 90, description: 'Historic tofu restaurant since 1635', tags: ['Food & Dining', 'History'], crowdLevel: 'low', energyLevel: 'low' },
    { title: 'Monkey Park Iwatayama', type: 'activity', category: 'nature', cost: 'budget', duration: 90, description: 'Mountain monkeys with city views', tags: ['Nature', 'Adventure'], crowdLevel: 'medium', energyLevel: 'high' },
    { title: 'Sake tasting in Fushimi', type: 'food', category: 'food', cost: 'moderate', duration: 120, description: 'Historic sake brewery district', tags: ['Food & Dining', 'History'], crowdLevel: 'low', energyLevel: 'low' },
    { title: 'Ryoanji rock garden', type: 'activity', category: 'culture', cost: 'budget', duration: 60, description: 'Famous Zen rock garden', tags: ['Culture', 'Wellness & Spa'], crowdLevel: 'medium', energyLevel: 'low' },
  ],
  // Generic alternatives for destinations without specific data
  _default: [
    { title: 'Walking city tour', type: 'activity', category: 'culture', cost: 'free', duration: 150, description: 'Explore the city on foot', tags: ['Culture', 'History'], crowdLevel: 'medium', energyLevel: 'high' },
    { title: 'Local market visit', type: 'food', category: 'food', cost: 'budget', duration: 90, description: 'Discover local flavors', tags: ['Food & Dining', 'Local Markets'], crowdLevel: 'medium', energyLevel: 'low' },
    { title: 'Museum visit', type: 'activity', category: 'art', cost: 'moderate', duration: 120, description: 'Visit a local museum', tags: ['Art & Museums', 'History'], crowdLevel: 'medium', energyLevel: 'low' },
    { title: 'Park or garden', type: 'activity', category: 'nature', cost: 'free', duration: 90, description: 'Relax in a green space', tags: ['Nature'], crowdLevel: 'low', energyLevel: 'low' },
    { title: 'Local dining experience', type: 'food', category: 'food', cost: 'moderate', duration: 90, description: 'Try a well-reviewed local restaurant', tags: ['Food & Dining'], crowdLevel: 'medium', energyLevel: 'low' },
    { title: 'Neighborhood walk', type: 'activity', category: 'culture', cost: 'free', duration: 120, description: 'Wander a charming neighborhood', tags: ['Culture', 'Photography'], crowdLevel: 'low', energyLevel: 'medium' },
    { title: 'Sunset viewpoint', type: 'activity', category: 'nature', cost: 'free', duration: 60, description: 'Find the best sunset spot', tags: ['Nature', 'Photography'], crowdLevel: 'low', energyLevel: 'low', bestTime: '18:00' },
    { title: 'Street food tour', type: 'food', category: 'food', cost: 'budget', duration: 120, description: 'Sample street food favorites', tags: ['Food & Dining', 'Adventure'], crowdLevel: 'medium', energyLevel: 'medium' },
    { title: 'Boutique city hotel', type: 'hotel', category: 'hotel', cost: 'moderate', duration: 480, description: 'Charming boutique hotel in the city center with local character and personalized service.', tags: ['Boutique', 'Central'], crowdLevel: 'low', energyLevel: 'low', rating: 4.3, reviewCount: 320, atmosphere: ['Cozy', 'Local'], wifi: true },
    { title: 'Budget hostel with private room', type: 'hotel', category: 'hotel', cost: 'budget', duration: 480, description: 'Clean, well-rated private room with access to shared common areas, perfect for solo or budget travelers.', tags: ['Budget', 'Social'], crowdLevel: 'medium', energyLevel: 'low', rating: 4.1, reviewCount: 510, atmosphere: ['Social', 'Casual'], wifi: true },
  ],
};

export function getAlternatives(destination: string): PlaceOption[] {
  return ALTERNATIVES[destination] ?? ALTERNATIVES._default;
}

export function getAllPoolDestinations(): string[] {
  return Object.keys(ALTERNATIVES).filter((k) => k !== '_default');
}

export function findReplacement(
  destination: string,
  currentActivity: Activity,
  options?: {
    interests?: string[];
    dislikes?: string[];
    budget?: string;
    avoidCrowds?: boolean;
    preferAdventurous?: boolean;
    preferRelaxed?: boolean;
  }
): PlaceOption | null {
  const pool = getAlternatives(destination);

  // Filter out activities with the same title
  let candidates = pool.filter((p) => p.title !== currentActivity.title);

  // Prefer same type
  const sameType = candidates.filter((p) => p.type === currentActivity.type);
  if (sameType.length > 0) candidates = sameType;

  // Apply filters
  if (options?.avoidCrowds) {
    const lowCrowd = candidates.filter((p) => p.crowdLevel === 'low');
    if (lowCrowd.length > 0) candidates = lowCrowd;
  }

  if (options?.preferRelaxed) {
    const lowEnergy = candidates.filter((p) => p.energyLevel === 'low');
    if (lowEnergy.length > 0) candidates = lowEnergy;
  }

  if (options?.preferAdventurous) {
    const highEnergy = candidates.filter((p) => p.energyLevel === 'high' || p.energyLevel === 'medium');
    if (highEnergy.length > 0) candidates = highEnergy;
  }

  if (options?.budget) {
    const budgetMap: Record<string, string[]> = {
      budget: ['free', 'budget'],
      moderate: ['free', 'budget', 'moderate'],
      premium: ['free', 'budget', 'moderate', 'premium'],
    };
    const allowed = budgetMap[options.budget] ?? budgetMap.moderate;
    const budgetFiltered = candidates.filter((p) => allowed.includes(p.cost));
    if (budgetFiltered.length > 0) candidates = budgetFiltered;
  }

  // Score by interest match
  if (options?.interests && options.interests.length > 0) {
    candidates.sort((a, b) => {
      const aScore = a.tags.filter((t) => options.interests!.includes(t)).length;
      const bScore = b.tags.filter((t) => options.interests!.includes(t)).length;
      return bScore - aScore;
    });
  }

  // Filter out disliked tags
  if (options?.dislikes && options.dislikes.length > 0) {
    if (options.dislikes.includes('Crowds')) {
      candidates = candidates.filter((p) => p.crowdLevel !== 'high');
    }
  }

  return candidates[0] ?? null;
}

export function findSurprise(
  destination: string,
  existingTitles: string[],
  interests: string[],
  dislikes: string[],
  searchTerms?: string,
): PlaceOption | null {
  const pool = getAlternatives(destination);
  let candidates = pool.filter((p) => !existingTitles.includes(p.title));

  // Filter by search terms if provided (match title, description, tags, or category)
  if (searchTerms) {
    const terms = searchTerms.toLowerCase().split(/\s+/);
    const filtered = candidates.filter((p) => {
      const haystack = `${p.title} ${p.description} ${p.tags.join(' ')} ${p.category}`.toLowerCase();
      return terms.some((t) => haystack.includes(t));
    });
    if (filtered.length > 0) candidates = filtered;
  }

  // Boost by interest match
  candidates.sort((a, b) => {
    const aScore = a.tags.filter((t) => interests.includes(t)).length;
    const bScore = b.tags.filter((t) => interests.includes(t)).length;
    return bScore - aScore;
  });

  if (dislikes.includes('Crowds')) {
    candidates = candidates.filter((p) => p.crowdLevel !== 'high');
  }

  // Pick a random one from top 3 for surprise element
  const top = candidates.slice(0, Math.min(3, candidates.length));
  return top[Math.floor(Math.random() * top.length)] ?? null;
}
