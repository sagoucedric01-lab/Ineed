import { describe, expect, it } from 'vitest';
import { renderTemplate } from './notifications.service.js';

describe('renderTemplate', () => {
  it('remplace les variables et vide celles qui manquent', () => {
    expect(renderTemplate('{{proName}} propose {{ amount }}.{{absent}}', { proName: 'Koffi', amount: '17 500 F CFA' })).toBe('Koffi propose 17 500 F CFA.');
  });
});
