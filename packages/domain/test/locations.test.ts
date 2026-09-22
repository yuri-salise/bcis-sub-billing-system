import { describe, it, expect } from 'vitest';
import {
  getMunicipalities,
  getBarangays,
  getDefaultPostalCode,
  searchLocations,
  normalizeLocation,
  CENTRAL_LOCATIONS,
} from '../src/locations.js';

describe('Centralized Locations Catalog', () => {
  it('provides official municipalities in Bukidnon operational hub', () => {
    const municipalities = getMunicipalities();
    expect(municipalities).toContain('Malaybalay');
    expect(municipalities).toContain('Valencia');
    expect(municipalities).toContain('Maramag');
    expect(municipalities).toContain('Manolo Fortich');
    expect(municipalities).toContain('Impasug-ong');
    expect(municipalities).toContain('Quezon');
  });

  it('provides official barangays for Malaybalay', () => {
    const barangays = getBarangays('Malaybalay');
    expect(barangays).toContain('Casisang');
    expect(barangays).toContain('Poblacion');
    expect(barangays).toContain('Sumpong');
    expect(barangays).toContain('Aglayan');
    expect(barangays).toContain('Kalasungay');
  });

  it('provides official barangays for Valencia', () => {
    const barangays = getBarangays('Valencia');
    expect(barangays).toContain('Bagontaas');
    expect(barangays).toContain('Poblacion');
    expect(barangays).toContain('Lumbo');
  });

  it('returns default postal code for municipalities', () => {
    expect(getDefaultPostalCode('Malaybalay')).toBe('8700');
    expect(getDefaultPostalCode('Valencia')).toBe('8709');
  });

  it('searches across barangays and municipalities accurately', () => {
    const casisangResults = searchLocations('Casisang');
    expect(casisangResults.length).toBeGreaterThan(0);
    expect(casisangResults[0].barangay).toBe('Casisang');
    expect(casisangResults[0].municipality).toBe('Malaybalay');

    const valenciaResults = searchLocations('Bagontaas');
    expect(valenciaResults.length).toBeGreaterThan(0);
    expect(valenciaResults[0].municipality).toBe('Valencia');
  });

  it('normalizes locations gracefully', () => {
    const normalized = normalizeLocation('malaybalay city', 'casisang');
    expect(normalized.municipality).toBe('Malaybalay');
    expect(normalized.barangay).toBe('Casisang');
    expect(normalized.province).toBe('Bukidnon');
    expect(normalized.postalCode).toBe('8700');
  });
});
