import { describe, expect, it } from 'vitest';
import { convert, modelName, pluralCamel } from './prisma-camelize.mjs';

describe('prisma-camelize', () => {
  it.each([
    ['service_requests', 'ServiceRequest'], ['categories', 'Category'], ['addresses', 'Address'],
    ['request_media', 'RequestMedia'], ['mission_status_history', 'MissionStatusHistory'],
    ['pro_weekly_hours', 'ProWeeklyHour'], ['pro_time_off', 'ProTimeOff'], ['ledger_entries', 'LedgerEntry'],
  ])('%s -> %s', (table, model) => expect(modelName(table)).toBe(model));

  it('met au pluriel les relations inverses', () => {
    expect(pluralCamel('Category')).toBe('categories');
    expect(pluralCamel('Address')).toBe('addresses');
    expect(pluralCamel('MissionStatusHistory')).toBe('missionStatusHistories');
  });

  it('nomme les relations d’après la clé étrangère et conserve les noms de la base', () => {
    const out = convert(`model users {
  id String @id
  first_name String?
  missions_client missions[] @relation("c")
}

model missions {
  id String @id
  client_id String
  users users @relation("c", fields: [client_id], references: [id])
}
`);
    expect(out).toContain('model User {');
    expect(out).toContain('firstName String? @map("first_name")');
    expect(out).toContain('client User @relation("c", fields: [clientId], references: [id])');
    expect(out).toContain('@@map("missions")');
  });
});
