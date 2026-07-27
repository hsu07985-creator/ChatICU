const { test, expect } = require('@playwright/test');
const { isAntibiotic } = require('../src/lib/antibiotic-codes.ts');
const { getMedicationEndDate, isPrnOrStat } = require('../src/lib/medications/medication-formatters.ts');
const { detectDuplicates, medCompareKey } = require('../src/lib/medications/duplicate-overlap.ts');

test.describe('Medication labels use structured API fields', () => {
  test('antibiotic and PRN/STAT labels ignore keyword-like text', () => {
    expect(isAntibiotic({
      isAntibiotic: false,
      orderCode: 'IAMOC2',
      category: 'antibiotic',
      name: 'Antibiotic (抗1)',
    })).toBe(false);
    expect(isAntibiotic({ isAntibiotic: true })).toBe(true);

    expect(isPrnOrStat({ prn: true, frequency: 'Q6H' })).toBe(true);
    expect(isPrnOrStat({ prn: false, frequency: 'STAT' })).toBe(true);
    expect(isPrnOrStat({ prn: false, frequency: 'stat' })).toBe(true);
    expect(isPrnOrStat({ prn: false, frequency: 'Q6HPRN' })).toBe(false);
    expect(isPrnOrStat({ prn: false, frequency: 'PRESTAT' })).toBe(false);
  });

  test('duplicate comparison uses exact full ATC then exact order code', () => {
    expect(medCompareKey({ atcCode: 'A10AB01', orderCode: 'INSULIN-A' })).toBe('atc:A10AB01');
    expect(medCompareKey({ atcCode: 'A10AB', orderCode: 'INSULIN-A' })).toBe('order:INSULIN-A');
    expect(medCompareKey({ name: 'Same Name', genericName: 'Same Generic' })).toBe('');

    expect(detectDuplicates(
      [{ atcCode: 'A10AB01', orderCode: 'A', name: 'Inpatient', genericName: 'Drug' }],
      [{ atcCode: 'A10AB02', orderCode: 'A', name: 'Outpatient', genericName: 'Drug' }],
    )).toHaveLength(0);

    expect(detectDuplicates(
      [{ atcCode: 'A10AB01', orderCode: 'A', name: 'First', genericName: 'First' }],
      [{ atcCode: 'A10AB01', orderCode: 'B', name: 'Second', genericName: 'Second' }],
    )).toHaveLength(1);

    expect(detectDuplicates(
      [{ atcCode: null, orderCode: 'EXACT', name: 'First', genericName: 'First' }],
      [{ atcCode: 'SHORT', orderCode: 'EXACT', name: 'Second', genericName: 'Second' }],
    )).toHaveLength(1);
  });

  test('chronic prescription coverage includes every fill', () => {
    expect(getMedicationEndDate({
      startDate: '2026-05-05',
      daysSupply: 28,
      chronicPrescriptionMonths: 3,
    }).toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });
});
