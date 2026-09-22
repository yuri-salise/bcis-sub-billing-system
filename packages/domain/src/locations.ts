/**
 * Centralized Philippine Locations Catalog (Bukidnon Operational Hub)
 * Standardizes Provinces, Municipalities/Cities, and Official Barangays
 * across Database, Backend API Services, and Frontend Workstations.
 */

export interface LocationEntry {
  municipality: string;
  province: string;
  postalCode: string;
  barangays: string[];
}

export const CENTRAL_LOCATIONS: Record<string, LocationEntry> = {
  Malaybalay: {
    municipality: 'Malaybalay',
    province: 'Bukidnon',
    postalCode: '8700',
    barangays: [
      'Aglayan',
      'Bangcud',
      'Busdi',
      'Cabangahan',
      'Caburacanan',
      'Canayan',
      'Capitan Angel',
      'Casisang',
      'Dalwangan',
      'Imbayao',
      'Indalasa',
      'Kalasungay',
      'Kibalabag',
      'Kulaman',
      'Laguitas',
      'Linabo',
      'Mampayag',
      'Managok',
      'Mandahikan',
      'Mapayag',
      'Mapulo',
      'Miglamin',
      'Poblacion',
      'Saint Peter',
      'San Jose',
      'San Martin',
      'Santo Niño',
      'Silae',
      'Simaya',
      'Sinanglanan',
      'Sumpong',
      'Zamboanguita',
    ],
  },
  Valencia: {
    municipality: 'Valencia',
    province: 'Bukidnon',
    postalCode: '8709',
    barangays: [
      'Bagontaas',
      'Banlag',
      'Barobo',
      'Batangan',
      'Catumbalon',
      'Colonia',
      'Concepcion',
      'Dagat-Kidavao',
      'Guinoyoran',
      'Kahaponan',
      'Laligan',
      'Lilingayon',
      'Lourdes',
      'Lumbayao',
      'Lumbo',
      'Lurogan',
      'Maapag',
      'Mabuhay',
      'Mailag',
      'Mount Nebo',
      'Nabag-o',
      'Pinatilan',
      'Poblacion',
      'San Carlos',
      'San Isidro',
      'Sinabuagan',
      'Sinayawan',
      'Sugod',
      'Tongantongan',
      'Tugaya',
      'Vintar',
    ],
  },
  Maramag: {
    municipality: 'Maramag',
    province: 'Bukidnon',
    postalCode: '8714',
    barangays: [
      'Anahawon',
      'Base Camp',
      'Bayabason',
      'Camp 1',
      'Colambugon',
      'Dagumbaan',
      'Damilag',
      'Dologon',
      'Kisanday',
      'Kuya',
      'La Roxas',
      'Panadtalan',
      'Panalsalan',
      'Poblacion',
      'San Miguel',
      'Tubigon',
    ],
  },
  'Manolo Fortich': {
    municipality: 'Manolo Fortich',
    province: 'Bukidnon',
    postalCode: '8703',
    barangays: [
      'Agusan Canyon',
      'Alae',
      'Dahilayan',
      'Damilag',
      'Diclum',
      'Guilang-guilang',
      'Kalugmanan',
      'Lindaban',
      'Lingion',
      'Lunocan',
      'Maluko',
      'Mambatangan',
      'Mampayag',
      'Minsuro',
      'Poblacion',
      'San Miguel',
      'Sankanan',
      'Santiago',
      'Santo Niño',
      'Tankulan',
      'Ticala',
    ],
  },
  'Impasug-ong': {
    municipality: 'Impasug-ong',
    province: 'Bukidnon',
    postalCode: '8702',
    barangays: [
      'Capitan Bayong',
      'Cawayan',
      'Dumalaguing',
      'Guihean',
      'Impalutao',
      'Kalabugao',
      'Kibenton',
      'La Fortuna',
      'Poblacion',
      'Sayawan',
    ],
  },
  Quezon: {
    municipality: 'Quezon',
    province: 'Bukidnon',
    postalCode: '8715',
    barangays: [
      'C-Handumanan',
      'Cebole',
      'Dumalama',
      'Kiburiao',
      'Kipaypayon',
      'Libertad',
      'Linabo',
      'Lipa',
      'Merangeran',
      'Minsalirac',
      'Minungan',
      'Palacapao',
      'Pinatilan',
      'Poblacion',
      'Puntian',
      'Salawagan',
      'San Jose',
      'San Roque',
      'Santa Cruz',
      'Santa Felomina',
    ],
  },
};

/**
 * Returns all standardized municipalities/cities.
 */
export function getMunicipalities(): string[] {
  return Object.keys(CENTRAL_LOCATIONS);
}

/**
 * Returns standardized barangays for a given municipality.
 * Defaults to Malaybalay barangays if unknown.
 */
export function getBarangays(municipality: string = 'Malaybalay'): string[] {
  const normalizedKey = Object.keys(CENTRAL_LOCATIONS).find(
    (k) => k.toLowerCase() === municipality.toLowerCase()
  );
  if (normalizedKey && CENTRAL_LOCATIONS[normalizedKey]) {
    return CENTRAL_LOCATIONS[normalizedKey].barangays;
  }
  return CENTRAL_LOCATIONS.Malaybalay.barangays;
}

/**
 * Returns default postal code for a municipality.
 */
export function getDefaultPostalCode(municipality: string = 'Malaybalay'): string {
  const normalizedKey = Object.keys(CENTRAL_LOCATIONS).find(
    (k) => k.toLowerCase() === municipality.toLowerCase()
  );
  if (normalizedKey && CENTRAL_LOCATIONS[normalizedKey]) {
    return CENTRAL_LOCATIONS[normalizedKey].postalCode;
  }
  return '8700';
}

/**
 * Searches across all centralized barangays and municipalities.
 */
export function searchLocations(query: string): Array<{
  barangay: string;
  municipality: string;
  province: string;
  postalCode: string;
}> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: Array<{
    barangay: string;
    municipality: string;
    province: string;
    postalCode: string;
  }> = [];

  for (const [munKey, loc] of Object.entries(CENTRAL_LOCATIONS)) {
    for (const brgy of loc.barangays) {
      if (
        brgy.toLowerCase().includes(q) ||
        munKey.toLowerCase().includes(q) ||
        loc.province.toLowerCase().includes(q)
      ) {
        results.push({
          barangay: brgy,
          municipality: loc.municipality,
          province: loc.province,
          postalCode: loc.postalCode,
        });
      }
    }
  }

  return results;
}

/**
 * Normalizes input municipality and barangay into standard canonical format.
 */
export function normalizeLocation(
  municipality?: string | null,
  barangay?: string | null
): { municipality: string; barangay: string; province: string; postalCode: string } {
  const munName = (municipality || 'Malaybalay').trim();
  const matchedMunKey =
    Object.keys(CENTRAL_LOCATIONS).find(
      (k) => k.toLowerCase() === munName.toLowerCase() || munName.toLowerCase().includes(k.toLowerCase())
    ) || 'Malaybalay';

  const loc = CENTRAL_LOCATIONS[matchedMunKey];
  const brgyName = (barangay || 'Poblacion').trim();

  // Find matching canonical barangay (case-insensitive)
  const matchedBrgy =
    loc.barangays.find(
      (b) => b.toLowerCase() === brgyName.toLowerCase() || b.toLowerCase().includes(brgyName.toLowerCase())
    ) || brgyName;

  return {
    municipality: loc.municipality,
    barangay: matchedBrgy,
    province: loc.province,
    postalCode: loc.postalCode,
  };
}
