import { describe, expect, it } from 'vitest';

import { gradeColor, gradeLabel, normalizeGrade } from '../helpers/grade';

describe('normalizeGrade', () => {
  it('returns null for nullish input', () => {
    expect(normalizeGrade(null)).toBeNull();
    expect(normalizeGrade(undefined)).toBeNull();
    expect(normalizeGrade('')).toBeNull();
  });

  it('accepts uppercase A–F', () => {
    for (const g of ['A', 'B', 'C', 'D', 'F'] as const) {
      expect(normalizeGrade(g)).toBe(g);
    }
  });

  it('uppercases lowercase input defensively', () => {
    expect(normalizeGrade('a')).toBe('A');
    expect(normalizeGrade('f')).toBe('F');
  });

  it('takes the first character when given a suffix like "A-"', () => {
    expect(normalizeGrade('A-')).toBe('A');
    expect(normalizeGrade('B+')).toBe('B');
  });

  it('rejects unrecognized letters (E, G, etc.)', () => {
    expect(normalizeGrade('E')).toBeNull();
    expect(normalizeGrade('G')).toBeNull();
    expect(normalizeGrade('Z')).toBeNull();
  });
});

describe('gradeColor', () => {
  it('maps each grade to its CSS variable', () => {
    expect(gradeColor('A')).toBe('var(--grade-a)');
    expect(gradeColor('B')).toBe('var(--grade-b)');
    expect(gradeColor('C')).toBe('var(--grade-c)');
    expect(gradeColor('D')).toBe('var(--grade-d)');
    expect(gradeColor('F')).toBe('var(--grade-f)');
  });

  it('returns the neutral token for unknown input', () => {
    expect(gradeColor(null)).toBe('var(--grade-na)');
    expect(gradeColor('?')).toBe('var(--grade-na)');
  });
});

describe('gradeLabel', () => {
  it('returns the letter when known', () => {
    expect(gradeLabel('A')).toBe('A');
    expect(gradeLabel('f')).toBe('F');
  });

  it('returns an em-dash for unknown input', () => {
    expect(gradeLabel(null)).toBe('—');
    expect(gradeLabel(undefined)).toBe('—');
    expect(gradeLabel('')).toBe('—');
    expect(gradeLabel('Z')).toBe('—');
  });
});
